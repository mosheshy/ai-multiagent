
import { invokeAgentText, invokeAgentStream } from "./agentRuntime.js";
import { BedrockLLM } from "../services/bedrockClient.js";

// System prompt tuned for coding help with structured, actionable output.
const CODE_SYS = `
You are a senior software engineer and code assistant.
Be direct, correct, and pragmatic. Prefer minimal, working examples.

When the user asks for code or debugging, respond with the following sections:
1) Plan
2) Code
3) Tests
4) Notes

Rules:
- Keep explanations concise and focus on correctness and edge cases.
- Use language-idiomatic patterns and safe defaults.
- If you must assume something, label it clearly as an assumption.
- Never invent API responses or filesystem state; show placeholders instead.
- Keep snippets small but complete (imports, minimal setup) unless the user requests otherwise.
`;

// Normalize output to a final string
function normalize(out) {
  if (typeof out === "string") return out.replace(/\[object Object\]/g, "").trim();
  try { return JSON.stringify(out); } catch { return String(out ?? "").trim(); }
}

// --------------------------- Non-Streaming -----------------------------------
export async function codingAgent({ text, models, region }) {
  const modelId = process.env.BEDROCK_MODEL_CODE || models?.code;
  const agentId = process.env.BEDROCK_CODE_AGENT_ID;
  const aliasId = process.env.BEDROCK_CODE_AGENT_ALIAS_ID;

  // 1) Try Bedrock Agent first (if configured)
  if (agentId && aliasId) {
    try {
      const answer = await invokeAgentText({
        region,
        agentId,
        agentAliasId: aliasId,
        inputText: text
      });
      return normalize(answer);
    } catch (e) {
      // fall through to model
    }
  }

  // 2) Fallback: direct model call
  const llm = new BedrockLLM({
    modelId,
    region,
    temperature: Number.isFinite(Number(process.env.CODE_TEMP)) ? Number(process.env.CODE_TEMP) : 0.2,
    maxTokens: Number.isFinite(Number(process.env.CODE_MAX_TOKENS)) ? Number(process.env.CODE_MAX_TOKENS) : 1400,
  });

  const answer = await llm.ask({ systemPrompt: CODE_SYS, userPrompt: text });
  return normalize(answer);
}

// ----------------------------- Streaming -------------------------------------
export async function* codingAgentStream({ text, models, region, signal }) {
  const useRegion =
    region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const modelId = process.env.BEDROCK_MODEL_CODE || models?.code;

  const agentId = process.env.BEDROCK_CODE_AGENT_ID;
  const aliasId = process.env.BEDROCK_CODE_AGENT_ALIAS_ID;

  // 1) Try Agent streaming
  if (agentId && aliasId) {
    try {
      for await (const piece of invokeAgentStream({
        region: useRegion,
        agentId,
        agentAliasId: aliasId,
        inputText: text,
        signal
      })) {
        if (signal?.aborted) return;
        yield piece;
      }
      return;
    } catch (e) {
      // fall through to model
    }
  }


  
  // 2) Fallback: model streaming
  if (!modelId) {
    throw new Error("codingAgentStream: No modelId resolved (set BEDROCK_MODEL_CODE or provide models.code).");
  }

  const llm = new BedrockLLM({
    modelId,
    region: useRegion,
    temperature: Number.isFinite(Number(process.env.CODE_TEMP)) ? Number(process.env.CODE_TEMP) : 0.2,
    maxTokens: Number.isFinite(Number(process.env.CODE_MAX_TOKENS)) ? Number(process.env.CODE_MAX_TOKENS) : 1400,
  });

  for await (const chunk of llm.askStream({
    systemPrompt: CODE_SYS,
    userPrompt: text,
    signal
  })) {
    if (signal?.aborted) return;
    yield chunk;
  }
}
