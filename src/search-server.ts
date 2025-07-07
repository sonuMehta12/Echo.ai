// src/search-server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

dotenv.config();

// Validate that the Tavily API key is present
if (!process.env.TAVILY_API_KEY) {
  throw new Error("TAVILY_API_KEY is not set in environment variables");
}

// --- MCP Server Setup ---
const server = new McpServer({
  name: "search-server",
  version: "1.0.0",
});

// --- Tool Registration ---
// We will create a single tool that wraps the LangChain Tavily tool.
// The name 'tavily_search_results_json' is the default name LangChain's tool uses,
// which makes integration easier.
server.registerTool("tavily_search_results_json", {
  title: "Tavily Search",
  description: "A search engine optimized for comprehensive, accurate, and trusted results. Useful for answering questions about recent events or for finding information on the web.",
  inputSchema: {
    query: z.string().describe("The search query to be sent to the search engine."),
  },
}, async ({ query }) => {
  console.error(`[Search Server] Performing search for: "${query}"`);

  // Instantiate the LangChain tool internally
  const tavilyTool = new TavilySearchResults({
    apiKey: process.env.TAVILY_API_KEY,
    maxResults: 5, // We can configure the tool here
  });

  // The handler's job is just to invoke the LangChain tool and return its output.
  const results = await tavilyTool.invoke(query);

  // The result from Tavily is a stringified JSON array. We'll return it as text.
  return {
    content: [{
      type: "text",
      text: results,
    }],
  };
});

// --- Server Startup ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 Search MCP Server is running via stdio...");
}

main().catch((error) => {
  console.error("Fatal error in search-server:", error);
  process.exit(1);
});