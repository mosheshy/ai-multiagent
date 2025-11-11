// Generic Agent — Agent-first with model fallback (Bedrock)
// Comments are in English only.

import { invokeAgentText, invokeAgentStream } from "./agentRuntime.js";
import { BedrockLLM } from "../services/bedrockClient.js";

const GEN_SYS = `
You are a precise, concise assistant.
- Be explicit about assumptions.
- Prefer short paragraphs and bullet points when helpful.
- If data is uncertain or missing, say so and suggest what would resolve it.
`;

// Normalize to string
function normalize(out) {
  if (typeof out === "string") return out.replace(/\[object Object\]/g, "").trim();
  try { return JSON.stringify(out); } catch { return String(out ?? "").trim(); }
}

// --------------------------- Non-Streaming -----------------------------------
export async function genericAgent({ text, models, region }) {
  const modelId = process.env.BEDROCK_MODEL_GENERAL || models?.general;
  const agentId = process.env.BEDROCK_GENERIC_AGENT_ID;
  const aliasId = process.env.BEDROCK_GENERIC_AGENT_ALIAS_ID;

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
      // fall back to model
    }
  }

  // 2) Fallback: direct model call
  const llm = new BedrockLLM({
    modelId,
    region,
    temperature: Number.isFinite(Number(process.env.GEN_TEMP)) ? Number(process.env.GEN_TEMP) : 0.2,
    maxTokens: Number.isFinite(Number(process.env.GEN_MAX_TOKENS)) ? Number(process.env.GEN_MAX_TOKENS) : 700,
  });

  const answer = await llm.ask({ systemPrompt: GEN_SYS, userPrompt: text });
  return normalize(answer);
}

// ----------------------------- Streaming -------------------------------------
export async function* genericAgentStream({ text, models, region, signal }) {
  const useRegion =
    region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const modelId = process.env.BEDROCK_MODEL_GENERAL || models?.general;

  const agentId = process.env.BEDROCK_GENERAL_AGENT_ID;
  const aliasId = process.env.BEDROCK_GENERAL_AGENT_ALIAS_ID;

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
      // fall through to model streaming
    }
  }

  // 2) Fallback: model streaming
  if (!modelId) {
    throw new Error("genericAgentStream: No modelId resolved (set BEDROCK_MODEL_GENERAL or provide models.general).");
  }

  const llm = new BedrockLLM({
    modelId,
    region: useRegion,
    temperature: Number.isFinite(Number(process.env.GEN_TEMP)) ? Number(process.env.GEN_TEMP) : 0.2,
    maxTokens: Number.isFinite(Number(process.env.GEN_MAX_TOKENS)) ? Number(process.env.GEN_MAX_TOKENS) : 700,
  });

  for await (const chunk of llm.askStream({
    systemPrompt: GEN_SYS,
    userPrompt: text,
    signal
  })) {
    if (signal?.aborted) return;
    yield chunk;
  }
}
