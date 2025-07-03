import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("🔄 Starting Gmail MCP server...");
  
  // Create transport with the correct parameters for the newer SDK
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/gmail-server.js"],
  });

  const client = new Client(
    { 
      name: "test-gmail-client", 
      version: "1.0.0" 
    },
    { 
      capabilities: {} 
    }
  );

  try {
    console.log("🔗 Connecting to Gmail MCP server...");
    await client.connect(transport);
    console.log("✅ Connected successfully!");

    // Test 1: List available tools
    console.log("\n📋 Listing available tools...");
    const tools = await client.listTools();
    console.log("Available tools:", tools.tools.map(t => t.name).join(", "));

    // Test 2: List emails
    console.log("\n📧 Testing list_emails with query 'is:unread'...");
    try {
      const result = await client.callTool({
        name: "list_emails",
        arguments: { 
          query: "is:unread", 
          max_results: 5 
        },
      });

      console.log("\n--- Email List Results ---");
      if (Array.isArray(result.content) && result.content[0] && "text" in result.content[0]) {
        console.log((result.content[0] as { text: string }).text);
      } else {
        console.log("Unexpected response format:", JSON.stringify(result, null, 2));
      }
      console.log("-------------------------\n");
    } catch (error) {
      console.error("❌ Error listing emails:", error);
    }

    // Test 3: List inbox emails (alternative test)
    console.log("\n📧 Testing list_emails with default inbox query...");
    try {
      const result = await client.callTool({
        name: "list_emails",
        arguments: { 
          max_results: 3 
        },
      });

      console.log("\n--- Inbox Results ---");
      if (Array.isArray(result.content) && result.content[0] && "text" in result.content[0]) {
        console.log((result.content[0] as { text: string }).text);
      } else {
        console.log("Unexpected response format:", JSON.stringify(result, null, 2));
      }
      console.log("--------------------\n");
    } catch (error) {
      console.error("❌ Error listing inbox emails:", error);
    }

    // Test 4: Create a draft (commented out to avoid actually creating drafts during testing)
    /*
    console.log("\n✏️  Testing create_draft...");
    try {
      const result = await client.callTool({
        name: "create_draft",
        arguments: {
          to: "test@example.com",
          subject: "Test Draft from MCP",
          body: "This is a test draft created by the Gmail MCP server."
        },
      });

      console.log("\n--- Draft Creation Result ---");
      if (result.content && result.content[0] && "text" in result.content[0]) {
        console.log(result.content[0].text);
      } else {
        console.log("Unexpected response format:", JSON.stringify(result, null, 2));
      }
      console.log("-----------------------------\n");
    } catch (error) {
      console.error("❌ Error creating draft:", error);
    }
    */

    console.log("🎉 All tests completed!");

  } catch (error) {
    console.error("❌ Connection or execution error:", error);
  } finally {
    console.log("\n🔌 Closing connection...");
    await client.close();
    console.log("✅ Connection closed.");
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Received SIGTERM, shutting down...');
  process.exit(0);
});

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});