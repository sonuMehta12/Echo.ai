import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from "child_process";
import OpenAI from "openai";
import readline from "readline/promises";
import dotenv from "dotenv";
import path from "path";
import { promises as fs } from "fs";

// --- NEW: LangChain/LangGraph Imports ---
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";


// Load environment variables
dotenv.config();

/**
 * Configuration and constants
 */
const CONFIG = {
  OPENAI_MODEL: "o4-mini", // Using a more powerful model for agentic work
  WORKSPACE_DIR: "./echo-workspace",
  SERVER_PATHS: {
    FILESYSTEM: "build/filesystem-server.js",
    GMAIL: "build/gmail-server.js",
    SEARCH: "build/search-server.js", // --- NEW: Path to the search server ---
  }
} as const;

/**
 * Validates that required environment variables are present
 * @throws {Error} If OPENAI_API_KEY is not set
 */
function validateEnvironment(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set in environment variables");
  }
  return apiKey;
}

/**
 * Represents a tool that can be called by the orchestrator
 */
interface AggregatedTool {
  name: string;
  description?: string;
  inputSchema: any;
  source: 'filesystem' | 'gmail' | 'search'; // --- UPDATED: Added 'search' ---
}

/**
 * Represents the result of a tool execution
 */
interface ToolExecutionResult {
  success: boolean;
  content: string;
  error?: string;
}

/**
 * Service connection configuration
 */
interface ServiceConfig {
  fsServerPath: string;
  fsRoot: string;
  gmailServerPath: string;
  searchServerPath: string; // --- NEW: Added search server path ---
}

/**
 * Echo AI Orchestrator - Manages multiple AI services and provides a unified interface
 * 
 * This class coordinates between filesystem operations, Gmail operations, search operations,
 * and OpenAI to provide an intelligent assistant that can perform complex multi-step tasks
 * using LangGraph for advanced reasoning and planning.
 */
class EchoOrchestrator {
  private fsServerProcess: ChildProcess | null = null;
  private gmailServerProcess: ChildProcess | null = null;
  private searchServerProcess: ChildProcess | null = null; // --- NEW ---
  private fsClient: Client;
  private gmailClient: Client;
  private searchClient: Client; // --- NEW ---
  private openai: OpenAI;
  private tools: AggregatedTool[] = [];
  private isConnected = false;
  private agent: any; // --- NEW: LangGraph agent ---

  /**
   * Initializes the orchestrator with required clients
   */
  constructor() {
    const apiKey = validateEnvironment();
    
    this.fsClient = new Client({ 
      name: "orchestrator-fs-client", 
      version: "1.0.0" 
    });
    this.gmailClient = new Client({ 
      name: "orchestrator-gmail-client", 
      version: "1.0.0" 
    });
    this.searchClient = new Client({ // --- NEW ---
      name: "orchestrator-search-client", 
      version: "1.0.0" 
    });
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Connects to all required services and aggregates their tools
   * @param config - Service configuration paths
   * @throws {Error} If connection to any service fails
   */
  public async connect(config: ServiceConfig): Promise<void> {
    try {
      console.log("🚀 Starting all services...");
      
      await this.connectFilesystemService(config.fsServerPath, config.fsRoot);
      await this.connectGmailService(config.gmailServerPath);
      await this.connectSearchService(config.searchServerPath); // --- NEW ---
      await this.aggregateTools();
      
      // --- NEW: Initialize the LangGraph agent after tools are ready ---
      this.initializeAgent();
      
      this.isConnected = true;
      console.log(`✅ Orchestrator ready. LangGraph agent initialized with ${this.tools.length} tools.`);
    } catch (error) {
      console.error("[Orchestrator] Failed to connect to services:", error);
      await this.disconnect();
      throw error;
    }
  }

  /**
   * Establishes connection to the filesystem service
   */
  private async connectFilesystemService(serverPath: string, rootPath: string): Promise<void> {
    console.log("[Orchestrator] Connecting to filesystem service...");
    
    this.fsServerProcess = spawn("node", [serverPath, rootPath]);
    const transport = new StdioClientTransport({ 
      command: "node", 
      args: [serverPath, rootPath] 
    });
    
    await this.fsClient.connect(transport);
    console.log("✅ Filesystem service connected");
  }

  /**
   * Establishes connection to the Gmail service
   */
  private async connectGmailService(serverPath: string): Promise<void> {
    console.log("[Orchestrator] Connecting to Gmail service...");
    
    this.gmailServerProcess = spawn("node", [serverPath]);
    const transport = new StdioClientTransport({ 
      command: "node", 
      args: [serverPath] 
    });
    
    await this.gmailClient.connect(transport);
    console.log("✅ Gmail service connected");
  }

  /**
   * --- NEW: Establishes connection to the search service ---
   */
  private async connectSearchService(serverPath: string): Promise<void> {
    console.log("[Orchestrator] Connecting to search service...");
    
    this.searchServerProcess = spawn("node", [serverPath]);
    const transport = new StdioClientTransport({ 
      command: "node", 
      args: [serverPath] 
    });
    
    await this.searchClient.connect(transport);
    console.log("✅ Search service connected");
  }

  /**
   * Collects and aggregates tools from all connected services
   */
  private async aggregateTools(): Promise<void> {
    console.log("[Orchestrator] Aggregating tools from all services...");
    
    const [fsToolsResponse, gmailToolsResponse, searchToolsResponse] = await Promise.all([
      this.fsClient.listTools(),
      this.gmailClient.listTools(),
      this.searchClient.listTools() // --- NEW ---
    ]);

    const fsTools: AggregatedTool[] = fsToolsResponse.tools.map(tool => ({ 
      ...tool, 
      source: 'filesystem' 
    }));
    const gmailTools: AggregatedTool[] = gmailToolsResponse.tools.map(tool => ({ 
      ...tool, 
      source: 'gmail' 
    }));
    const searchTools: AggregatedTool[] = searchToolsResponse.tools.map(tool => ({ // --- NEW ---
      ...tool, 
      source: 'search' 
    }));

    this.tools = [...fsTools, ...gmailTools, ...searchTools];
  }

  /**
   * --- NEW: Initialize the LangGraph Agent ---
   */
  private initializeAgent(): void {
    console.log("[Orchestrator] Initializing LangGraph agent...");

    // Create LangChain-compatible tools that act as proxies to our MCP services
    const langChainTools = this.tools.map(toolDef => {
      return new DynamicTool({
        name: toolDef.name,
        description: toolDef.description || "No description available.",
        func: async (input: string | Record<string, any>): Promise<string> => {
          // This function is the bridge between LangGraph and our MCP clients
          let args: any;
          
          // Handle different input formats
          if (typeof input === 'string') {
            // If it's a string, try to parse as JSON, otherwise use as query
            try {
              args = JSON.parse(input);
            } catch {
              args = { query: input };
            }
          } else {
            args = input;
          }
          
          // Route to the correct client based on tool source
          let client: Client;
          switch (toolDef.source) {
            case 'filesystem':
              client = this.fsClient;
              break;
            case 'gmail':
              client = this.gmailClient;
              break;
            case 'search':
              client = this.searchClient;
              break;
          }
          
          try {
            console.log(`[LangGraph] Executing ${toolDef.source}.${toolDef.name}...`);
            const result = await client.callTool({ 
              name: toolDef.name, 
              arguments: args 
            });
            
            const resultText = this.extractResultText(result);
            console.log(`[LangGraph] ✅ ${toolDef.name} completed`);
            return resultText;
          } catch (error: any) {
            const errorMsg = `Error executing tool ${toolDef.name}: ${error.message}`;
            console.error(`[LangGraph] ❌ ${errorMsg}`);
            return errorMsg;
          }
        },
      });
    });

    // Initialize the LangChain ChatOpenAI model
    const llm = new ChatOpenAI({ 
      modelName: CONFIG.OPENAI_MODEL, 
      temperature: 1 // Keep it focused but allow some creativity
    });

    // Create the ReAct agent using LangGraph's prebuilt agent
    const agentCheckpointer = new MemorySaver()
    this.agent = createReactAgent({
      llm,
      tools: langChainTools,
      messageModifier: this.getSystemPrompt(), // Use our custom system prompt
      checkpointSaver: agentCheckpointer,

    });

    console.log("✅ LangGraph agent initialized");
  }

  /**
   * --- REFACTORED: processQuery now uses the LangGraph agent ---
   */
  public async processQuery(query: string, threadId?: string): Promise<void> {
    if (!this.isConnected || !this.agent) {
      console.error("❌ Cannot process query: Orchestrator not ready.");
      return;
    }

    console.log(`\n🤔 Processing query: "${query}"`);

    try {
      // Create a unique thread ID if not provided
      const currentThreadId = threadId || `thread_${Date.now()}`;
      
      // Invoke the LangGraph agent with the user's query
      const finalState = await this.agent.invoke(
        { messages: [new HumanMessage(query)] },
        { 
          configurable: { thread_id: currentThreadId },
          recursionLimit: 20 // Prevent infinite loops
        }
      );

      // Extract the final response from the agent
      const lastMessage = finalState.messages[finalState.messages.length - 1];
      const responseContent = lastMessage.content;

      console.log("\n✅ Echo says:", responseContent);
    } catch (error) {
      console.error("❌ Error during agent execution:", error);
      console.log("\n❌ I encountered an error while processing your request. Please try again or rephrase your question.");
    }
  }

  /**
   * Starts an interactive chat loop for user interaction
   */
  public async startChatLoop(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Create a unique thread ID for this conversation session
    const threadId = `thread_${Date.now()}`;
    
    this.displayWelcomeMessage(threadId);

    try {
      while (true) {
        const query = await rl.question("\n> ");
        
        if (this.isExitCommand(query)) {
          break;
        }
        
        if (query.trim() === "") {
          continue;
        }

        await this.processQuery(query, threadId);
      }
    } finally {
      rl.close();
    }
  }

  /**
   * Displays welcome message and usage instructions
   */
  private displayWelcomeMessage(threadId: string): void {
    console.log("\n" + "=".repeat(50));
    console.log("🚀 Echo AI Assistant (LangGraph Edition) is Ready!");
    console.log("=".repeat(50));
    console.log(`Conversation ID: ${threadId}`);
    console.log("Available capabilities:");
    console.log("  📁 File operations (read, write, list, etc.)");
    console.log("  📧 Email management (read, send, search)");
    console.log("  🔍 Web search (current events, research)");
    console.log("\nTry commands like:");
    console.log("  • 'What is the current status of the James Webb telescope?'");
    console.log("  • 'Find my latest unread email and save it to a file'");
    console.log("  • 'Search for recent news about AI and summarize it'");
    console.log("  • Type 'quit' or 'exit' to close");
  }

  /**
   * Checks if the input is an exit command
   */
  private isExitCommand(input: string): boolean {
    const normalized = input.toLowerCase().trim();
    return normalized === "quit" || normalized === "exit";
  }

  /**
   * Disconnects from all services and cleans up resources
   */
  public async disconnect(): Promise<void> {
    console.log("\n🔌 Shutting down all services...");

    const disconnectPromises = [
      this.fsClient?.close(),
      this.gmailClient?.close(),
      this.searchClient?.close() // --- NEW ---
    ].filter(Boolean);

    await Promise.allSettled(disconnectPromises);

    this.fsServerProcess?.kill();
    this.gmailServerProcess?.kill();
    this.searchServerProcess?.kill(); // --- NEW ---
    
    this.isConnected = false;
    console.log("✅ All services disconnected");
  }

  /**
   * Extracts text content from tool execution result
   */
  private extractResultText(result: any): string {
    return (result.content as any)?.[0]?.text || JSON.stringify(result);
  }

  /**
   * Generates the system prompt for the LLM with available tools and workflows
   */
  private getSystemPrompt(): string {
    const toolList = this.tools
      .map(tool => `- ${tool.name} (${tool.source}): ${tool.description}`)
      .join('\n');

    return `You are "Echo," a powerful AI executive assistant with advanced reasoning capabilities. Your goal is to help users by executing tasks across different services using a systematic approach.

AVAILABLE TOOLS:
${toolList}

CORE CAPABILITIES:
- File Operations: Create, read, write, and manage local files
- Email Management: Read, send, search, and manage emails
- Web Search: Find current information, research topics, and get real-time data

EXECUTION APPROACH:
1. **Analyze** the user's request carefully
2. **Plan** the sequence of actions needed
3. **Execute** tools in the optimal order
4. **Verify** results and provide clear feedback
5. **Summarize** what was accomplished

CRITICAL WORKFLOWS:
**Email Drafting (RAG & Quality Check):**
When drafting email replies, follow this sequence:
1. Use 'list_emails' to find the email thread
2. Use 'read_email' to get full content
3. Use 'quality_check' tool with draft content before creating
4. Only create draft if quality check passes

**Research Tasks:**
1. Use search tools to gather current information
2. Cross-reference multiple sources when possible
3. Summarize findings clearly
4. Save important information to files if requested

**Multi-step Tasks:**
- Break complex requests into logical steps
- Use intermediate results to inform next actions
- Provide progress updates for long-running tasks

Always be helpful, accurate, and efficient. If you're unsure about something, ask for clarification rather than making assumptions.`;
  }
}

/**
 * Creates the workspace directory if it doesn't exist
 */
async function ensureWorkspaceExists(workspacePath: string): Promise<void> {
  try {
    await fs.mkdir(workspacePath, { recursive: true });
  } catch (error) {
    console.error("❌ Could not create workspace directory. Check permissions.");
    throw error;
  }
}

/**
 * Sets up graceful shutdown handlers
 */
function setupShutdownHandlers(orchestrator: EchoOrchestrator): void {
  const shutdown = async (signal: string) => {
    console.log(`\n📡 Received ${signal}. Shutting down gracefully...`);
    await orchestrator.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  const serviceConfig: ServiceConfig = {
    fsServerPath: path.resolve(process.cwd(), CONFIG.SERVER_PATHS.FILESYSTEM),
    gmailServerPath: path.resolve(process.cwd(), CONFIG.SERVER_PATHS.GMAIL),
    searchServerPath: path.resolve(process.cwd(), CONFIG.SERVER_PATHS.SEARCH), // --- NEW ---
    fsRoot: path.resolve(process.cwd(), CONFIG.WORKSPACE_DIR)
  };

  const orchestrator = new EchoOrchestrator();
  setupShutdownHandlers(orchestrator);

  try {
    await ensureWorkspaceExists(serviceConfig.fsRoot);
    await orchestrator.connect(serviceConfig);
    await orchestrator.startChatLoop();
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await orchestrator.disconnect();
  }
}

// Start the application
main().catch(console.error);