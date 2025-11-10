// File: test-invoke.js
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import dotenv from "dotenv";

// Load environment variables (Important!)
dotenv.config();

// --- Test Configuration ---
// We are testing the classify agent
const TEST_AGENT_ID = "41TWOEKTR8";
const TEST_ALIAS_ID = "BH339QER2L";
const TEST_SESSION_ID = `test-${Date.now()}`;
const TEST_INPUT = "ping";
// ------------------------

async function runTest() {
  console.log(`[INFO] Attempting to invoke Agent: ${TEST_AGENT_ID}...`);

  const client = new BedrockAgentRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1"
    // The SDK will load credentials automatically from the .env
  });

  const command = new InvokeAgentCommand({
    agentId: TEST_AGENT_ID,
    agentAliasId: TEST_ALIAS_ID,
    sessionId: TEST_SESSION_ID,
    inputText: TEST_INPUT,
  });

  try {
    const response = await client.send(command);

    // If we got here, it succeeded!
    console.log("✅✅✅ SUCCESS! ✅✅✅");
    console.log("Permissions (both for the User and the Role) are correct!");
    console.log("-----------------------------------------------");

    // Reading the response from the agent
    let responseText = "";
    if (response.completion) {
      for await (const event of response.completion) {
        if (event.chunk && event.chunk.bytes) {
          responseText += new TextDecoder().decode(event.chunk.bytes);
        }
      }
    }
    console.log("Agent Response:", responseText);

  } catch (err) {
    // If we failed, let's see why
    console.error("❌❌❌ TEST FAILED ❌❌❌");
    if (err.name === "AccessDeniedException") {
      console.error("[ERROR] Received AccessDeniedException.");
      console.error("Meaning: The User's permissions are correct, but an IAM permission is still missing from the Agent's Role.");
      console.error("Please ensure KMS permissions are added to the Agent's Role.");
    } else {
      console.error("[ERROR] The error is not AccessDenied. It's a different problem:");
      console.error(err);
    }
  }
}

runTest();