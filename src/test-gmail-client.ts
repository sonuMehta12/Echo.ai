import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("🔄 Starting Gmail MCP server for testing...");
  
  // This is the correct way to use StdioClientTransport to spawn a process.
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

    // Test 1: List available tools to confirm 'quality_check' is present
    console.log("\n📋 Listing available tools...");
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name);
    console.log("Available tools:", toolNames.join(", "));
    if (!toolNames.includes('quality_check')) {
        throw new Error("TEST FAILED: quality_check tool is not registered!");
    }
    console.log("✅ 'quality_check' tool is available.");

    // --- NEW: Test cases for the quality_check tool ---

    // Test 2: A good, professional message
    console.log("\n🧪 Testing quality_check with a GOOD message...");
    try {
      const goodText = "Hello team, just a friendly reminder that the reports are due by 5 PM today. Please let me know if you have any questions. Thanks!";
      const result = await client.callTool({
        name: "quality_check",
        arguments: { text: goodText },
      });

      console.log("--- Quality Check Result (Good Text) ---");
      const verdict = (result.content as any)[0].text;
      console.log(`Verdict: ${verdict}`);
      if (verdict !== 'OK') {
          throw new Error(`TEST FAILED: Expected 'OK', but got '${verdict}'`);
      }
      console.log("✅ PASSED: Good text was approved correctly.");
      console.log("----------------------------------------\n");

    } catch (error) {
      console.error("❌ FAILED: Error during good text quality check:", error);
    }

    // Test 3: A harsh, unprofessional message
    console.log("🧪 Testing quality_check with a BAD message...");
    try {
      const badText = "Why are your reports late again? I need them on my desk NOW.";
      const result = await client.callTool({
        name: "quality_check",
        arguments: { text: badText },
      });

      console.log("--- Quality Check Result (Bad Text) ---");
      const verdict = (result.content as any)[0].text;
      console.log(`Verdict: ${verdict}`);
      if (!verdict.startsWith('REJECTED')) {
          throw new Error(`TEST FAILED: Expected 'REJECTED', but got '${verdict}'`);
      }
      console.log("✅ PASSED: Bad text was rejected correctly.");
      console.log("---------------------------------------\n");

    } catch (error) {
      console.error("❌ FAILED: Error during bad text quality check:", error);
    }

    console.log("🎉 All tests completed!");

  } catch (error) {
    console.error("❌ Connection or execution error:", error);
  } finally {
    console.log("\n🔌 Closing connection...");
    await client.close();
    // The transport automatically handles terminating the child process.
    console.log("✅ Connection closed and server terminated.");
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Received SIGINT, shutting down...');
  process.exit(0);
});

main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});