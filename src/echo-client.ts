// src/filesystem-client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import readline from "readline/promises";
import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";

// Load environment variables
dotenv.config();

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set in environment variables");
}

// Types
interface MCPTool {
  name: string;
  description?: string;
  inputSchema: any;
}

interface ToolCallResult {
  content: Array<{
    type: string;
    text: string;
  }>;
}

// Type guard for tool results
function isValidToolResult(result: unknown): result is ToolCallResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as any).content) &&
    (result as any).content.length > 0 &&
    typeof (result as any).content[0] === "object" &&
    (result as any).content[0] !== null &&
    "type" in (result as any).content[0] &&
    "text" in (result as any).content[0]
  );
}

class FilesystemMCPClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private openai: OpenAI;
  private tools: MCPTool[] = [];
  private isConnected = false;

  constructor() {
    this.client = new Client(
      {
        name: "filesystem-client",
        version: "1.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
  }

  async connect(serverPath: string, rootDirectory: string): Promise<void> {
    try {
      console.log(`[Client] Connecting to server: ${serverPath}`);
      console.log(`[Client] Root directory: ${rootDirectory}`);

      // Create root directory if it doesn't exist
      await fs.mkdir(rootDirectory, { recursive: true });

      // Setup transport
      this.transport = new StdioClientTransport({
        command: "node",
        args: [serverPath, rootDirectory],
      });

      

      // Connect to server
      await this.client.connect(this.transport);
      
      console.log("[Client] ✅ Connected to MCP server");

      // List available tools
      const toolsResponse = await this.client.listTools();
      this.tools = toolsResponse.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      console.log(`[Client] ✅ Available tools: ${this.tools.map(t => t.name).join(", ")}`);

      // List available resources
      try {
        const resourcesResponse = await this.client.listResources();
        console.log(`[Client] ✅ Available resources: ${resourcesResponse.resources.length} items`);
      } catch (error) {
        console.log("[Client] ℹ️  No resources available yet");
      }

      this.isConnected = true;
    } catch (error) {
      console.error(`[Client] Failed to connect: ${error}`);
      throw error;
    }
  }

  private convertToolsToOpenAIFormat(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return this.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "No description provided",
        parameters: tool.inputSchema,
      },
    }));
  }

  async processQuery(query: string): Promise<void> {
    if (!this.isConnected) {
      console.error("[Client] Not connected to server");
      return;
    }

    // Handle special commands
    if (query.trim().toLowerCase() === "ls") {
      await this.listResources();
      return;
    }

    if (query.trim().toLowerCase() === "help") {
      this.showHelp();
      return;
    }

    // Process query with OpenAI
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are a helpful filesystem assistant. You can read, write, create, and delete files and directories.
        
Available tools:
- read_file: Read the contents of a file
- write_file: Write content to a file
- create_directory: Create a new directory
- list_directory: List contents of a directory
- delete_file: Delete a file

Always use relative paths from the root directory. Be helpful and explain what you're doing.`,
      },
      {
        role: "user",
        content: query,
      },
    ];

    try {
      const openaiTools = this.convertToolsToOpenAIFormat();
      
      const response = await this.openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? "auto" : undefined,
      });

      const choice = response.choices[0];
      const responseMessage = choice.message;

      // Handle tool calls
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        console.log("[Client] 🔧 Executing tools...");
        messages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[Client] 📞 Calling tool: ${toolName}`);
          console.log(`[Client] 📝 Arguments:`, toolArgs);

          try {
            const result = await this.client.callTool({
              name: toolName,
              arguments: toolArgs,
            });

            let resultText: string;
            if (isValidToolResult(result)) {
              resultText = result.content[0].text;
            } else {
              resultText = `Unexpected tool result format: ${JSON.stringify(result)}`;
            }

            console.log(`[Client] ✅ Tool result: ${resultText}`);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: resultText,
            });
          } catch (error) {
            const errorMessage = `Tool execution failed: ${error}`;
            console.error(`[Client] ❌ ${errorMessage}`);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: errorMessage,
            });
          }
        }

        // Get final response from OpenAI
        const finalResponse = await this.openai.chat.completions.create({
          model: "gpt-4-turbo-preview",
          messages,
        });

        const finalContent = finalResponse.choices[0].message.content;
        if (finalContent) {
          console.log("\n💬 Assistant:", finalContent);
        }
      } else if (responseMessage.content) {
        console.log("\n💬 Assistant:", responseMessage.content);
      }
    } catch (error) {
      console.error(`[Client] Error processing query: ${error}`);
    }
  }

  private async listResources(): Promise<void> {
    try {
      const resourcesResponse = await this.client.listResources();
      console.log("\n📁 Available resources:");
      
      if (resourcesResponse.resources.length === 0) {
        console.log("   No resources found");
        return;
      }

      resourcesResponse.resources.forEach((resource, index) => {
        const icon = resource.mimeType === "inode/directory" ? "📁" : "📄";
        console.log(`   ${icon} ${resource.name} (${resource.description})`);
      });
    } catch (error) {
      console.error(`[Client] Error listing resources: ${error}`);
    }
  }

  private showHelp(): void {
    console.log(`
📖 Available commands:
   
   Basic commands:
   • ls          - List files and directories
   • help        - Show this help message
   • quit        - Exit the client
   
   Natural language commands:
   • "read the file named example.txt"
   • "create a new file called hello.txt with content 'Hello World'"
   • "list the contents of the src directory"
   • "create a directory called projects"
   • "delete the file named temp.txt"
   
   Available tools:
   ${this.tools.map(tool => `   • ${tool.name} - ${tool.description}`).join('\n')}
`);
  }

  async startChatLoop(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\n🚀 Filesystem MCP Client Ready!");
    console.log("Type 'help' for available commands or 'quit' to exit.");

    while (true) {
      try {
        const query = await rl.question("\n> ");
        
        if (query.trim().toLowerCase() === "quit") {
          console.log("👋 Goodbye!");
          break;
        }

        if (query.trim() === "") {
          continue;
        }

        await this.processQuery(query);
      } catch (error) {
        console.error(`[Client] Error in chat loop: ${error}`);
      }
    }

    rl.close();
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.close();
        console.log("[Client] ✅ Disconnected from server");
      } catch (error) {
        console.error(`[Client] Error disconnecting: ${error}`);
      }
    }
    this.isConnected = false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error("Usage: node filesystem-client.js <server-path> <root-directory>");
    console.error("Example: node filesystem-client.js ./build/filesystem-server.js ./test-files");
    process.exit(1);
  }

  const [serverPath, rootDirectory] = args;
  
  // Create test files for demonstration
  try {
    await fs.mkdir(rootDirectory, { recursive: true });
    const testFile = path.join(rootDirectory, "welcome.txt");
    await fs.writeFile(testFile, "Welcome to the MCP Filesystem Client!\n\nThis is a test file created automatically.\nTry commands like:\n- read the file named welcome.txt\n- create a new file\n- list directory contents");
    console.log(`[Client] ✅ Created test file: ${testFile}`);
  } catch (error) {
    console.error(`[Client] Warning: Could not create test files: ${error}`);
  }

  const client = new FilesystemMCPClient();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n[Client] Shutting down...");
    await client.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n[Client] Shutting down...");
    await client.disconnect();
    process.exit(0);
  });

  try {
    await client.connect(serverPath, rootDirectory);
    await client.startChatLoop();
  } catch (error) {
    console.error(`[Client] Fatal error: ${error}`);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

// Start the client
main().catch((error) => {
  console.error(`[Client] Unhandled error: ${error}`);
  process.exit(1);
});