// Minimal coding agent stub used for routing/demo purposes.
// In the full app this would call a model or run tooling; here we return
// a simple response so the server can run without external credentials.
export async function codingAgent({ text, models, region }) {
  // Return a short canned response that echoes the request.
  return `Code assistant (mock): I received ${JSON.stringify(text).slice(0,200)}...`;
}

export async function* codingAgentStream({ text, models, region }) {
  const resp = await codingAgent({ text, models, region });
  // Yield small chunks to simulate streaming
  for (let i = 0; i < resp.length; i += 80) {
    yield resp.slice(i, i + 80);
    // slight pause between chunks
    await new Promise(r => setTimeout(r, 10));
  }
}
