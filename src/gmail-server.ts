import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
  ListToolsRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "fs";
import path from "path";
import process from "process";
import { google, gmail_v1 } from "googleapis";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// --- Configuration ---
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set for the server's summarization tool.");
}
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Authentication ---
async function loadCredentials(): Promise<any> {
  const content = await fs.readFile(CREDENTIALS_PATH, "utf-8");
  return JSON.parse(content);
}

async function authorize(): Promise<gmail_v1.Gmail> {
  const credentials = await loadCredentials();
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Try to load token
  try {
    const token = await fs.readFile(TOKEN_PATH, "utf-8");
    oAuth2Client.setCredentials(JSON.parse(token));
  } catch (err) {
    throw new Error("No valid token found. Please authenticate and save a token.json file.");
  }

  return google.gmail({ version: "v1", auth: oAuth2Client });
}

// --- Helper Functions ---
function decodeEmailBody(part: gmail_v1.Schema$MessagePart): string {
  if (part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf-8");
  }
  if (part.parts) {
    const textPart = part.parts.find(p => p.mimeType === "text/plain");
    if (textPart) {
      return decodeEmailBody(textPart);
    }
    // If no text/plain, try text/html
    const htmlPart = part.parts.find(p => p.mimeType === "text/html");
    if (htmlPart) {
      return decodeEmailBody(htmlPart);
    }
  }
  return "";
}

function createMimeMessage(params: { 
  to: string; 
  from: string; 
  subject: string; 
  body: string; 
  inReplyTo?: string 
}): string {
  const { to, from, subject, body, inReplyTo } = params;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];
  
  if (inReplyTo) {
    headers.push(`In-Reply-To: <${inReplyTo}>`);
    headers.push(`References: <${inReplyTo}>`);
  }
  
  const message = [...headers, "", body].join("\n");
  return Buffer.from(message).toString("base64url");
}

// --- MCP Server Setup ---
const server = new Server(
  { 
    name: "gmail-server", 
    version: "1.0.0" 
  },
  { 
    capabilities: { 
      tools: {} 
    } 
  }
);

// --- Tool Definitions ---
server.setRequestHandler(ListToolsRequestSchema, async (request: ListToolsRequest) => {
  return {
    tools: [
      {
        name: "list_emails",
        description: "Fetches a list of emails, with powerful filtering options.",
        inputSchema: {
          type: "object",
          properties: {
            query: { 
              type: "string", 
              description: "Gmail search query (e.g., 'from:boss@company.com', 'is:unread', 'subject:\"Project Update\"'). Defaults to 'is:inbox'." 
            },
            max_results: { 
              type: "number", 
              description: "Maximum number of emails to return. Defaults to 10." 
            },
          },
        },
      },
      {
        name: "read_email",
        description: "Reads the full content of a specific email by its ID.",
        inputSchema: {
          type: "object",
          properties: { 
            message_id: { 
              type: "string",
              description: "The ID of the email to read"
            } 
          },
          required: ["message_id"],
        },
      },
      {
        name: "create_draft",
        description: "Creates a new email draft. Does not send it.",
        inputSchema: {
          type: "object",
          properties: {
            to: { 
              type: "string",
              description: "The recipient's email address"
            },
            subject: { 
              type: "string",
              description: "The email subject"
            },
            body: { 
              type: "string",
              description: "The content of the email"
            },
            in_reply_to: { 
              type: "string", 
              description: "The Message-ID of the email being replied to, for threading." 
            },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "send_email",
        description: "Directly sends an email. This is a more 'dangerous' tool, so confirmation should be requested before using it.",
        inputSchema: {
          type: "object",
          properties: {
            to: { 
              type: "string",
              description: "The recipient's email address"
            },
            subject: { 
              type: "string",
              description: "The email subject"
            },
            body: { 
              type: "string",
              description: "The content of the email"
            },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "summarize_thread",
        description: "Reads all messages in an email thread and generates an AI summary using server-side LLM.",
        inputSchema: {
          type: "object",
          properties: { 
            thread_id: { 
              type: "string",
              description: "The ID of the email thread to summarize"
            } 
          },
          required: ["thread_id"],
        },
      },
    ],
  };
});

// --- Tool Logic ---
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  try {
    const gmail = await authorize();
    const { name, arguments: args } = request.params;
    const toolArgs = args as Record<string, any>;

    switch (name) {
      case "list_emails": {
        const query = toolArgs.query || "is:inbox";
        const maxResults = toolArgs.max_results || 10;
        
        const res = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: maxResults,
        });
        
        const messages = res.data.messages || [];
        
        if (messages.length === 0) {
          return { 
            content: [{ 
              type: "text", 
              text: `No emails found matching query: ${query}` 
            }] 
          };
        }

        const emailDetails = await Promise.all(
          messages.map(async (msg) => {
            const msgData = await gmail.users.messages.get({ 
              userId: "me", 
              id: msg.id!, 
              format: "metadata", 
              metadataHeaders: ["Subject", "From", "Date"] 
            });
            
            const subject = msgData.data.payload?.headers?.find(h => h.name === "Subject")?.value || "No Subject";
            const from = msgData.data.payload?.headers?.find(h => h.name === "From")?.value || "Unknown Sender";
            const date = msgData.data.payload?.headers?.find(h => h.name === "Date")?.value || "Unknown Date";
            
            return `ID: ${msg.id}\nFrom: ${from}\nDate: ${date}\nSubject: ${subject}\nSnippet: ${msgData.data.snippet || "No preview available"}`;
          })
        );
        
        return { 
          content: [{ 
            type: "text", 
            text: emailDetails.join("\n" + "=".repeat(50) + "\n") 
          }] 
        };
      }

      case "read_email": {
        const messageId = toolArgs.message_id;
        if (!messageId) {
          throw new Error("message_id is required");
        }

        const res = await gmail.users.messages.get({ 
          userId: "me", 
          id: messageId 
        });
        
        if (!res.data.payload) {
          throw new Error("Email payload not found");
        }

        const subject = res.data.payload.headers?.find(h => h.name === "Subject")?.value || "No Subject";
        const from = res.data.payload.headers?.find(h => h.name === "From")?.value || "Unknown Sender";
        const date = res.data.payload.headers?.find(h => h.name === "Date")?.value || "Unknown Date";
        const body = decodeEmailBody(res.data.payload);
        
        const emailContent = `From: ${from}\nDate: ${date}\nSubject: ${subject}\n\n${body}`;
        
        return { 
          content: [{ 
            type: "text", 
            text: emailContent 
          }] 
        };
      }

      case "create_draft": {
        const { to, subject, body, in_reply_to } = toolArgs;
        
        if (!to || !subject || !body) {
          throw new Error("to, subject, and body are required");
        }

        const profile = await gmail.users.getProfile({ userId: "me" });
        const rawMessage = createMimeMessage({
          to,
          from: profile.data.emailAddress!,
          subject,
          body,
          inReplyTo: in_reply_to,
        });

        const res = await gmail.users.drafts.create({
          userId: "me",
          requestBody: { 
            message: { 
              raw: rawMessage 
            } 
          },
        });

        return { 
          content: [{ 
            type: "text", 
            text: `Draft created successfully with ID: ${res.data.id}` 
          }] 
        };
      }

      case "send_email": {
        const { to, subject, body } = toolArgs;
        
        if (!to || !subject || !body) {
          throw new Error("to, subject, and body are required");
        }

        const profile = await gmail.users.getProfile({ userId: "me" });
        const rawMessage = createMimeMessage({
          to,
          from: profile.data.emailAddress!,
          subject,
          body,
        });

        const res = await gmail.users.messages.send({
          userId: "me",
          requestBody: { 
            raw: rawMessage 
          },
        });

        return { 
          content: [{ 
            type: "text", 
            text: `Email sent successfully. Message ID: ${res.data.id}` 
          }] 
        };
      }

      case "summarize_thread": {
        const threadId = toolArgs.thread_id;
        if (!threadId) {
          throw new Error("thread_id is required");
        }

        const thread = await gmail.users.threads.get({ 
          userId: "me", 
          id: threadId 
        });
        
        const messages = thread.data.messages || [];
        
        if (messages.length === 0) {
          return { 
            content: [{ 
              type: "text", 
              text: "No messages found in this thread" 
            }] 
          };
        }

        let threadContent = `Thread Summary for Thread ID: ${threadId}\n\n`;
        
        for (const message of messages) {
          const from = message.payload?.headers?.find(h => h.name === "From")?.value || "Unknown";
          const date = message.payload?.headers?.find(h => h.name === "Date")?.value || "Unknown Date";
          const subject = message.payload?.headers?.find(h => h.name === "Subject")?.value || "No Subject";
          const body = decodeEmailBody(message.payload!);
          
          threadContent += `From: ${from}\nDate: ${date}\nSubject: ${subject}\n\n${body}\n\n${"=".repeat(40)}\n\n`;
        }

        const summaryResponse = await openai.chat.completions.create({
          model: "gpt-4-turbo-preview",
          messages: [
            { 
              role: "system", 
              content: "You are an expert email summarizer. Summarize the following email thread into key points. Identify the main topic, any questions asked, decisions made, and action items. Be concise but comprehensive." 
            },
            { 
              role: "user", 
              content: threadContent 
            },
          ],
          max_tokens: 1000,
        });

        const summary = summaryResponse.choices[0].message.content;
        
        return { 
          content: [{ 
            type: "text", 
            text: `EMAIL THREAD SUMMARY:\n\n${summary}` 
          }] 
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Error in tool ${request.params.name}:`, error);
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
});

// --- Server Startup ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 Gmail MCP Server is running");
  console.error("Ready to handle requests...");
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.error('Received SIGINT, shutting down gracefully...');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  await server.close();
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});