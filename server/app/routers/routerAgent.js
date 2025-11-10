// app/routers/routerAgent.js
// ESM module

import { BedrockLLM } from "../services/bedrockClient.js";
import { invokeAgentText } from "./agentRuntime.js";
// import { webSearch } from "../services/tools.js"; // Optional: keep if you'll use it soon
import { codingAgent, codingAgentStream } from "./codeAgent.js";
import { financeAgent, financeAgentStream } from "./financeAgent.js";
import { genericAgent, genericAgentStream } from "./genericAgent.js";
import { childLogger } from "../utils/logger.js";

const logger = childLogger("routerAgent");

// ----------------------------- Intent Prompt ---------------------------------
const INTENT_SYS = `
You are a strict intent classifier.
Return a single JSON object with keys: label, confidence.
label MUST be one of: "code", "finance", "general".
confidence MUST be a number in [0,1].
Return ONLY JSON. No explanations. No markdown. No code fences.
`;

// ----------------------------- Small Helpers ---------------------------------

/** Clamp a number into [0,1]. */
function clamp01(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

/** Extract the first {...} JSON block (non-greedy). */
function extractFirstJson(text) {
  const m = String(text || "").match(/\{[\s\S]*?\}/);
  return m ? m[0] : null;
}

/**
 * Parse a JSON-ish string safely:
 * 1) Try to extract the first {...} block
 * 2) Fall back to direct JSON.parse
 * 3) Return null on failure
 */
function safeParseJson(raw) {
  try {
    const cand = extractFirstJson(raw) || raw;
    return JSON.parse(String(cand || "").trim());
  } catch {
    return null;
  }
}

/** Normalize an incoming streamed piece to a string for heuristics. */
function normalizeToString(piece) {
  if (piece == null) return "";
  if (typeof piece === "string") return piece;
  if (typeof piece === "object") {
    // Common streaming schemas may pass {delta,text,choices,...}
    if (typeof piece.delta === "string") return piece.delta;
    if (typeof piece.text === "string") return piece.text;
    try {
      return JSON.stringify(piece);
    } catch {
      return String(piece);
    }
  }
  return String(piece);
}

/** Resolve a usable region with reasonable fallbacks. */
function resolveRegion(region) {
  return (
    region ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1"
  );
}

// ----------------------------- Intent Routing --------------------------------

/**
 * Classify intent using "Agent-first → LLM fallback".
 * @returns {Promise<{label: "code"|"finance"|"general", confidence: number, source: "agent"|"llm"|"fallback"}>}
 */
async function classifyIntent({ text, models, region }) {
  const useRegion = resolveRegion(region);
  const agentId = process.env.BEDROCK_CLASSIFY_AGENT_ID;
  const aliasId = process.env.BEDROCK_CLASSIFY_ALIAS_ID;

  // 1) Try Bedrock Agent first (if configured)
  if (agentId && aliasId) {
    try {
      const out = await invokeAgentText({
        region: useRegion,
        agentId,
        agentAliasId: aliasId,
        inputText: text,
      });

      const parsed = safeParseJson(out);
      if (parsed) {
        const label = String(parsed.label || "").toLowerCase();
        const confidence = clamp01(parsed.confidence);
        if (["code", "finance", "general"].includes(label)) {
          return { label, confidence, source: "agent" };
        }
      }
      logger.warn("Agent returned non-parseable result for intent; falling back.", { out });
    } catch (e) {
      logger.warn("Agent classify failed; falling back.", { error: String(e) });
    }
  }

  // 2) Fallback: direct model call
  logger.info("Using Fallback LLM for classification...");
  const modelId =
    models?.classify ||
    process.env.BEDROCK_MODEL_CLASSIFY ||
    process.env.BEDROCK_MODEL_GENERAL; // safe fallback

  const ctrl = new BedrockLLM({
    modelId,
    region: useRegion,
    temperature: 0.0,
    maxTokens: 96,
  });

  const raw = await ctrl.ask({ systemPrompt: INTENT_SYS, userPrompt: text });
  const parsed = safeParseJson(raw);

  if (parsed) {
    const label = String(parsed.label || "").toLowerCase();
    const confidence = clamp01(parsed.confidence);
    if (["code", "finance", "general"].includes(label)) {
      logger.info(`Fallback classified intent as: ${label}`);
      return { label, confidence, source: "llm" };
    }
    logger.warn("Fallback returned unknown label; defaulting to general.", { parsed });
  } else {
    logger.error("Failed to parse classification JSON from fallback", { raw });
  }

  // 3) Safe default if all else fails
  logger.warn("Defaulting to 'general' intent after classification failure.");
  return { label: "general", confidence: 0.5, source: "fallback" };
}

// ------------------------------- Non-Streaming -------------------------------

/**
 * Non-streaming route: runs a single agent to completion and returns the answer.
 */
export async function routeAndAnswer({ text, models, region }) {
  const { label: intent } = await classifyIntent({ text, models, region });
  logger.info(`Classified intent="${intent}" for text="${String(text).slice(0, 30)}..."`);

  if (intent === "code") {
    return {
      intent,
      agentName: "Code Agent",
      answer: await codingAgent({ text, models, region }),
    };
  }

  if (intent === "finance") {
    return {
      intent,
      agentName: "Finance Agent",
      answer: await financeAgent({ text, models, region }),
    };
  }

  return {
    intent,
    agentName: "General Agent",
    answer: await genericAgent({ text, models, region }),
  };
}

// --------------------------------- Streaming ---------------------------------

/**
 * Streaming route: yields structured SSE-style chunks.
 * Fixes "Unexpected end of JSON input" by either:
 *   - bypassing JSON parsing entirely for the "code" intent, or
 *   - buffering partial JSON chunks for other intents until valid.
 *
 * Each yielded object has shape:
 *   { type: "intent"|"delta"|"error"|"done", intent, ... }
 */
export async function* routeAndAnswerStream({ text, models, region, signal }) {
  // 1) Classify (non-streaming)
  const { label: intent } = await classifyIntent({ text, models, region });
  logger.info(`Streaming request classified as "${intent}"`);

  // 1a) Emit initial intent metadata
  const agentName =
    intent === "code" ? "Code Agent" :
    intent === "finance" ? "Finance Agent" :
    "General Agent";

  yield { type: "intent", intent, agentName };

  try {
    // 2) Route to the proper streaming agent (async generator)
    const useRegion = resolveRegion(region);
    let stream;
    if (intent === "code") {
      stream = codingAgentStream({ text, models, region: useRegion, signal });
    } else if (intent === "finance") {
      stream = financeAgentStream({ text, models, region: useRegion, signal });
    } else {
      stream = genericAgentStream({ text, models, region: useRegion, signal });
    }

    // 3) Stream handling
    // For "code" intent: never try to parse JSON; pass through raw text pieces.
    // For others: small JSON buffer that accumulates until JSON.parse succeeds.
    let jsonBuf = "";

    for await (const piece of stream) {
      if (signal?.aborted) {
        logger.warn("Streaming aborted by signal.");
        break;
      }

      const s = normalizeToString(piece);
      if (!s) continue;

      if (intent === "code") {
        // Plain passthrough for code to avoid JSON partials
        yield { type: "delta", intent, delta: s };
        continue;
      }

      // For non-code intents, attempt buffered JSON parsing
      const trimmed = s.trim();
      const looksJson = /^[\[{]/.test(trimmed);

      if (looksJson) {
        jsonBuf += trimmed;

        // Try parsing the accumulated JSON buffer
        try {
          const parsed = JSON.parse(jsonBuf);
          jsonBuf = ""; // parsed OK → clear buffer

          // Normalize common provider schemas → text
          let deltaText = "";
          if (parsed?.type === "content_block_delta") {
            deltaText = parsed?.delta?.text || "";
          } else if (parsed?.choices) {
            // e.g., OpenAI-style incremental
            deltaText = parsed.choices[0]?.delta?.content ?? "";
          } else if (typeof parsed?.delta === "string") {
            deltaText = parsed.delta;
          } else if (typeof parsed?.text === "string") {
            deltaText = parsed.text;
          } else {
            // last resort: stringify the parsed object
            deltaText = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
          }

          if (deltaText) {
            yield { type: "delta", intent, delta: deltaText };
          }
          continue;
        } catch {
          // Not a complete JSON document yet → wait for next chunk
          continue;
        }
      }

      // Not JSON-looking → treat as plain text
      yield { type: "delta", intent, delta: s };
    }

    // 4) Flush any dangling partial JSON buffer (emit raw to avoid losing bytes)
    if (jsonBuf.trim()) {
      yield { type: "delta", intent, delta: jsonBuf };
      jsonBuf = "";
    }
  } catch (e) {
    logger.error("Error during agent stream:", e);
    yield { type: "error", intent, error: "Error during streaming" };
  }

  // 5) Final completion signal
  yield { type: "done", intent };
}
