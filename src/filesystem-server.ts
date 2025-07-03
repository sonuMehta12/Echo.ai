#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Server configuration
const SERVER_CONFIG = {
  name: "filesystem-server",
  version: "1.0.0",
} as const;

// Server state management
interface ServerState {
  rootPath: string | null;
}

const state: ServerState = {
  rootPath: null,
};

// Create server instance
const server = new Server(SERVER_CONFIG, {
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Helper functions
function validateRootPath(): string {
  if (!state.rootPath) {
    throw new Error("Root path not set. Please initialize the server first.");
  }
  return state.rootPath;
}

function sanitizePath(inputPath: string): string {
  // Remove any path traversal attempts
  const normalized = path.normalize(inputPath);
  if (normalized.includes("..")) {
    throw new Error("Path traversal not allowed");
  }
  return normalized;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getFileStats(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      size: stats.size,
      modified: stats.mtime,
    };
  } catch (error) {
    throw new Error(`Cannot access file: ${error}`);
  }
}

// Initialize server with root path
async function initializeServer(rootPath: string): Promise<void> {
  try {
    const resolvedPath = path.resolve(rootPath);
    await fs.access(resolvedPath);
    state.rootPath = resolvedPath;
    console.error(`[Server] Root path set to: ${resolvedPath}`);
  } catch (error) {
    throw new Error(`Cannot access root path: ${rootPath}`);
  }
}

// Request handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const rootPath = validateRootPath();
  
  try {
    const items = await fs.readdir(rootPath);
    const resources = await Promise.all(
      items.map(async (item) => {
        const itemPath = path.join(rootPath, item);
        const stats = await getFileStats(itemPath);
        
        return {
          uri: `file://${itemPath}`,
          name: item,
          description: stats.isDirectory 
            ? `Directory: ${item}`
            : `File: ${item} (${stats.size} bytes)`,
          mimeType: stats.isDirectory ? "inode/directory" : "text/plain",
        };
      })
    );
    
    return { resources };
  } catch (error) {
    throw new Error(`Failed to list resources: ${error}`);
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const rootPath = validateRootPath();
  const resourceUri = request.params.uri;
  
  if (!resourceUri.startsWith("file://")) {
    throw new Error("Only file:// URIs are supported");
  }
  
  const filePath = fileURLToPath(resourceUri);
  
  // Ensure file is within root directory
  if (!filePath.startsWith(rootPath)) {
    throw new Error("Access denied: File is outside root directory");
  }
  
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: "text/plain",
          text: content,
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to read file: ${error}`);
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_file",
        description: "Read the complete contents of a file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file relative to the root directory",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file, creating or overwriting as needed",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file relative to the root directory",
            },
            content: {
              type: "string",
              description: "Content to write to the file",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "create_directory",
        description: "Create a new directory",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the directory relative to the root directory",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "list_directory",
        description: "List contents of a directory",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the directory relative to the root directory",
              default: ".",
            },
          },
        },
      },
      {
        name: "delete_file",
        description: "Delete a file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file relative to the root directory",
            },
          },
          required: ["path"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const rootPath = validateRootPath();
  const { name, arguments: args } = request.params;
  
  if (!args || typeof args !== "object") {
    throw new Error("Invalid arguments provided");
  }
  
  const toolArgs = args as Record<string, unknown>;
  
  try {
    switch (name) {
      case "read_file": {
        const filePath = sanitizePath(toolArgs.path as string);
        const fullPath = path.join(rootPath, filePath);
        
        if (!(await fileExists(fullPath))) {
          throw new Error(`File not found: ${filePath}`);
        }
        
        const content = await fs.readFile(fullPath, "utf-8");
        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      }
      
      case "write_file": {
        const filePath = sanitizePath(toolArgs.path as string);
        const content = toolArgs.content as string;
        const fullPath = path.join(rootPath, filePath);
        
        // Ensure parent directory exists
        const parentDir = path.dirname(fullPath);
        await fs.mkdir(parentDir, { recursive: true });
        
        await fs.writeFile(fullPath, content, "utf-8");
        return {
          content: [
            {
              type: "text",
              text: `Successfully wrote ${content.length} characters to ${filePath}`,
            },
          ],
        };
      }
      
      case "create_directory": {
        const dirPath = sanitizePath(toolArgs.path as string);
        const fullPath = path.join(rootPath, dirPath);
        
        await fs.mkdir(fullPath, { recursive: true });
        return {
          content: [
            {
              type: "text",
              text: `Successfully created directory: ${dirPath}`,
            },
          ],
        };
      }
      
      case "list_directory": {
        const dirPath = sanitizePath((toolArgs.path as string) || ".");
        const fullPath = path.join(rootPath, dirPath);
        
        if (!(await fileExists(fullPath))) {
          throw new Error(`Directory not found: ${dirPath}`);
        }
        
        const items = await fs.readdir(fullPath);
        const itemDetails = await Promise.all(
          items.map(async (item) => {
            const itemPath = path.join(fullPath, item);
            const stats = await getFileStats(itemPath);
            return `${stats.isDirectory ? "📁" : "📄"} ${item}${stats.isDirectory ? "/" : ` (${stats.size} bytes)`}`;
          })
        );
        
        return {
          content: [
            {
              type: "text",
              text: `Contents of ${dirPath}:\n${itemDetails.join("\n")}`,
            },
          ],
        };
      }
      
      case "delete_file": {
        const filePath = sanitizePath(toolArgs.path as string);
        const fullPath = path.join(rootPath, filePath);
        
        if (!(await fileExists(fullPath))) {
          throw new Error(`File not found: ${filePath}`);
        }
        
        await fs.unlink(fullPath);
        return {
          content: [
            {
              type: "text",
              text: `Successfully deleted: ${filePath}`,
            },
          ],
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    throw new Error(`Tool execution failed: ${error}`);
  }
});

// Server startup and initialization
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: node filesystem-server.js <root-directory>");
    process.exit(1);
  }
  
  const rootDirectory = args[0];
  
  try {
    await initializeServer(rootDirectory);
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error(`[Server] Filesystem MCP Server running on stdio`);
    console.error(`[Server] Root directory: ${state.rootPath}`);
    
  } catch (error) {
    console.error(`[Server] Failed to start: ${error}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.error("[Server] Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("[Server] Shutting down gracefully...");
  process.exit(0);
});

// Start the server
if (require.main === module) {
  main().catch((error) => {
    console.error(`[Server] Fatal error: ${error}`);
    process.exit(1);
  });
}