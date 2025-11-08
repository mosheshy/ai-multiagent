// agentRuntime.js
// Minimal stub for invokeAgentText used by routerAgent. The real app would
// call Bedrock Agents runtime. Here we provide a harmless mock that returns
// a simple string so code paths that attempt agent invocation won't crash.
export async function invokeAgentText({ region, agentId, agentAliasId, inputText }) {
  // Return a fake agent response. Keep it deterministic.
  return JSON.stringify({ label: "general", confidence: 0.75, note: `mock agent ${agentId || "?"}` });
}
