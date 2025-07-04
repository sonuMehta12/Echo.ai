import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from "child_process";
import OpenAI from "openai";
import readline from "readline/promises";
import dotenv from "dotenv";
import path from "path";
import { promises as fs } from "fs";

// Load environment variables
dotenv.config();

/**
 * Configuration and constants
 */
const CONFIG = {
  OPENAI_MODEL: "gpt-4-turbo-preview",
  WORKSPACE_DIR: "./echo-workspace",
  SERVER_PATHS: {
    FILESYSTEM: "build/filesystem-server.js",
    GMAIL: "build/gmail-server.js"
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
  source: 'filesystem' | 'gmail';
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
}

/**
 * Echo AI Orchestrator - Manages multiple AI services and provides a unified interface
 * 
 * This class coordinates between filesystem operations, Gmail operations, and OpenAI
 * to provide an intelligent assistant that can perform complex multi-step tasks.
 */
class EchoOrchestrator {
  private fsServerProcess: ChildProcess | null = null;
  private gmailServerProcess: ChildProcess | null = null;
  private fsClient: Client;
  private gmailClient: Client;
  private openai: OpenAI;
  private tools: AggregatedTool[] = [];
  private isConnected = false;

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
      await this.aggregateTools();
      
      this.isConnected = true;
      console.log(`✅ Orchestrator ready. Total tools available: ${this.tools.length}`);
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
   * Collects and aggregates tools from all connected services
   */
  private async aggregateTools(): Promise<void> {
    console.log("[Orchestrator] Aggregating tools from all services...");
    
    const [fsToolsResponse, gmailToolsResponse] = await Promise.all([
      this.fsClient.listTools(),
      this.gmailClient.listTools()
    ]);

    const fsTools: AggregatedTool[] = fsToolsResponse.tools.map(tool => ({ 
      ...tool, 
      source: 'filesystem' 
    }));
    const gmailTools: AggregatedTool[] = gmailToolsResponse.tools.map(tool => ({ 
      ...tool, 
      source: 'gmail' 
    }));

    this.tools = [...fsTools, ...gmailTools];
  }

  /**
   * Processes a user query by planning, executing tools, and summarizing results
   * @param query - The user's natural language query
   */
  public async processQuery(query: string): Promise<void> {
    if (!this.isConnected) {
      console.error("❌ Cannot process query: Not connected to services");
      return;
    }

    console.log(`\n🤔 Processing query: "${query}"`);

    try {
      const messages = this.initializeConversation(query);
      const planningResponse = await this.generateExecutionPlan(messages);
      
      messages.push(planningResponse);

      if (planningResponse.tool_calls) {
        await this.executeToolCalls(planningResponse.tool_calls, messages);
        await this.generateFinalResponse(messages);
      } else {
        console.log("\n✅ Echo says:", planningResponse.content);
      }
    } catch (error) {
      console.error("❌ Error processing query:", error);
    }
  }

  /**
   * Initializes the conversation context for a new query
   */
  private initializeConversation(query: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [
      { role: "system", content: this.getSystemPrompt() },
      { role: "user", content: query }
    ];
  }

  /**
   * Generates an execution plan using OpenAI
   */
  private async generateExecutionPlan(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
    const openaiTools = this.convertToolsToOpenAIFormat();
    
    const response = await this.openai.chat.completions.create({
      model: CONFIG.OPENAI_MODEL,
      messages,
      tools: openaiTools,
      tool_choice: "auto"
    });

    return response.choices[0].message;
  }

  /**
   * Converts internal tool format to OpenAI function calling format
   */
  private convertToolsToOpenAIFormat() {
    return this.tools.map(tool => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }

  /**
   * Executes a series of tool calls and adds results to conversation
   */
  private async executeToolCalls(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  ): Promise<void> {
    console.log("⚙️ Executing planned tools...");

    for (const toolCall of toolCalls) {
      const result = await this.executeToolCall(toolCall);
      
      messages.push({
        tool_call_id: toolCall.id,
        role: "tool",
        content: result.content
      });
    }
  }

  /**
   * Executes a single tool call
   */
  private async executeToolCall(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall
  ): Promise<ToolExecutionResult> {
    const { name: toolName, arguments: toolArgsString } = toolCall.function;
    
    try {
      const toolArgs = JSON.parse(toolArgsString);
      const toolDefinition = this.findTool(toolName);
      
      if (!toolDefinition) {
        const error = `Unknown tool: ${toolName}`;
        console.error(`❌ ${error}`);
        return { success: false, content: `Error: ${error}` };
      }

      console.log(`  - Executing ${toolDefinition.source}.${toolName}...`);
      
      const result = await this.callTool(toolDefinition, toolName, toolArgs);
      const resultText = this.extractResultText(result);
      
      console.log(`  - ✅ Success: ${this.truncateText(resultText, 100)}`);
      return { success: true, content: resultText };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  - ❌ Error executing ${toolName}:`, errorMessage);
      return { success: false, content: `Error: ${errorMessage}` };
    }
  }

  /**
   * Finds a tool by name in the aggregated tools list
   */
  private findTool(toolName: string): AggregatedTool | undefined {
    return this.tools.find(tool => tool.name === toolName);
  }

  /**
   * Calls the appropriate service client based on tool source
   */
  private async callTool(
    toolDefinition: AggregatedTool, 
    toolName: string, 
    toolArgs: any
  ): Promise<any> {
    const client = toolDefinition.source === 'filesystem' ? this.fsClient : this.gmailClient;
    return await client.callTool({ name: toolName, arguments: toolArgs });
  }

  /**
   * Extracts text content from tool execution result
   */
  private extractResultText(result: any): string {
    return (result.content as any)?.[0]?.text || JSON.stringify(result);
  }

  /**
   * Truncates text to specified length with ellipsis
   */
  private truncateText(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  }

  /**
   * Generates final response by asking LLM to summarize results
   */
  private async generateFinalResponse(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  ): Promise<void> {
    console.log("💬 Generating final response...");
    
    const response = await this.openai.chat.completions.create({
      model: CONFIG.OPENAI_MODEL,
      messages
    });

    console.log("\n✅ Echo says:", response.choices[0].message.content);
  }

  /**
   * Starts an interactive chat loop for user interaction
   */
  public async startChatLoop(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.displayWelcomeMessage();

    try {
      while (true) {
        const query = await rl.question("\n> ");
        
        if (this.isExitCommand(query)) {
          break;
        }
        
        if (query.trim() === "") {
          continue;
        }

        await this.processQuery(query);
      }
    } finally {
      rl.close();
    }
  }

  /**
   * Displays welcome message and usage instructions
   */
  private displayWelcomeMessage(): void {
    console.log("\n" + "=".repeat(40));
    console.log("🚀 Echo AI Assistant is Ready!");
    console.log("=".repeat(40));
    console.log("Try commands like:");
    console.log("  • 'What tools can you use?'");
    console.log("  • 'Find my latest unread email and save it to latest.txt'");
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
      this.gmailClient?.close()
    ].filter(Boolean);

    await Promise.allSettled(disconnectPromises);

    this.fsServerProcess?.kill();
    this.gmailServerProcess?.kill();
    
    this.isConnected = false;
    console.log("✅ All services disconnected");
  }

  /**
   * Generates the system prompt for the LLM with available tools and workflows
   */
  private getSystemPrompt(): string {
    const toolList = this.tools
      .map(tool => `- ${tool.name}: ${tool.description}`)
      .join('\n');

    return `You are "Echo," a powerful AI executive assistant. Your goal is to help users by executing tasks across different services. You have access to tools for local file operations and email management.

EXECUTION PROCESS:
1. Think step-by-step to create a plan
2. Identify the correct tool(s) from the available list
3. Chain tools together when tasks require multiple steps
4. Execute the plan by calling necessary tools in sequence

CRITICAL WORKFLOWS:
**Email Drafting (RAG & Quality Check):**
When drafting email replies, follow this exact sequence:
1. Use 'list_emails' with search query to find the email thread
2. Use 'read_email' with message ID to get full content
3. Formulate draft content mentally (DO NOT call create_draft yet)
4. **MANDATORY:** Call 'quality_check' tool with draft content
5. **Analyze result:**
   - If 'OK': proceed to create draft
   - If 'REJECTED': stop and inform user about quality issues
6. If quality check passed, use 'create_draft' tool

AVAILABLE TOOLS:
${toolList}

Always summarize what you have accomplished after completing tasks.`;
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