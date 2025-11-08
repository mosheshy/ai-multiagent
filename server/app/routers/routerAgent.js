import { BedrockLLM } from "../services/bedrockClient.js";
import { invokeAgentText } from "./agentRuntime.js";
import { webSearch } from "../services/tools.js";
// English Comments: Import streaming functions
import { codingAgent, codingAgentStream } from "./codeAgent.js";
import { financeAgent } from "./financeAgent.js";
import { genericAgent, genericAgentStream } from "./genericAgent.js";
import { childLogger } from "../utils/logger.js";
const logger = childLogger("routerAgent");

const INTENT_SYS = `You are a strict intent classifier.
Return a single JSON object with keys: label, confidence.
The label MUST be one of "code", "finance", "general". Confidence in [0,1].
Return ONLY JSON.`;

// if agent is present -> use agent; else -> fallback to LLM
async function classifyIntent({ text, models, region }) {
  const agentId = process.env.BEDROCK_CLASSIFY_AGENT_ID;
  const aliasId = process.env.BEDROCK_CLASSIFY_ALIAS_ID;

  // 1) Try Agent
  // --- EASY FIX ---
  // We are commenting out the Agent block. This forces the code
  // to skip to the "Fallback" section (step 2), which uses the
  // BEDROCK_MODEL_CLASSIFY (Haiku) model instead.
  // This bypasses the "AccessDeniedException" you are seeing.
  /*
  if (agentId && aliasId) {
    try {
      const raw = await invokeAgentText({
        region,
        agentId,
        agentAliasId: aliasId,
        inputText: text
      });
      // Try parse JSON; if agent returns free-form, add a tiny guard:
      try {
        const j = JSON.parse(raw);
        const label = String(j.label || "").toLowerCase();
        const confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0.6));
        if (["code","finance","general"].includes(label)) {
          return { label, confidence, source: "agent" };
        }
      } catch (_) {
        // If the agent returns plain text like "code", normalize:
        const low = raw.toLowerCase();
        if (low.includes("code")) return { label: "code", confidence: 0.6, source: "agent-text" };
        if (low.includes("finance")) return { label: "finance", confidence: 0.6, source: "agent-text" };
        return { label: "general", confidence: 0.5, source: "agent-text" };
      }
    } catch (agentError) {
      // Log the agent error but proceed to fallback
      logger.warn("Bedrock Agent call failed", agentError);
    }
  }
  */

  // 2) Fallback: use a small/cheap foundation model
  logger.info("Using Fallback LLM for classification...");
  const ctrl = new BedrockLLM({ modelId: models.classify, region, temperature: 0.0, maxTokens: 80 });

  // FIX: The system prompt (INTENT_SYS) already contains all instructions.
  // The user prompt should *only* contain the raw user text.
  const raw = await ctrl.ask({ systemPrompt: INTENT_SYS, userPrompt: text });

  try {
    const j = JSON.parse((raw || "").trim());
    const label = String(j.label || "").toLowerCase();
    const confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0.5));
    if (["code","finance","general"].includes(label)) {
      logger.info(`Fallback classified intent as: ${label}`);
      return { label, confidence, source: "llm" };
    }
  } catch(e) {
    logger.error("Failed to parse classification JSON from fallback", e);
  }
  
  // English Comments: If parsing fails, default to "general"
  logger.warn("Defaulting to 'general' intent after fallback failure.");
  return { label: "general", confidence: 0.5, source: "fallback" };
}

export async function routeAndAnswer({ text, models, region }) {
  const { label: intent } = await classifyIntent({ text, models, region });

  logger.info(`Classified intent="${intent}" for text="${text.slice(0,30)}..."`);
  if (intent === "code") {
    return { intent, answer: await codingAgent({ text, models, region }) };
  }
  if (intent === "finance") {
    return { intent, answer: await financeAgent({ text, models, region }) };
  }

  // English Comments: Fallback to generic agent which includes web search
  const sources = await webSearch(text, 3);
  const ctx = sources.map(s => `- ${s.title} | ${s.url}`).join("\n");
  const ans = await genericAgent({ text: `${text}\n\nSources:\n${ctx}`, models, region });
  return { intent: "general", answer: ans, sources };
}


// --- True Streaming ---

// English Comments: Selects the correct *streaming* agent based on intent
export async function* routeAndAnswerStream({ text, models, region }) {
  // 1. Get Intent (This is a non-streaming call)
  const { label: intent } = await classifyIntent({ text, models, region });
  logger.info(`Streaming request classified as "${intent}"`);
  
  // Yield the intent first, so the client knows what's coming
  yield `data: ${JSON.stringify({ intent })}\n\n`;

  try {
    // 2. Route to the correct streaming agent
    let stream;
    if (intent === "code") {
      stream = codingAgentStream({ text, models, region });
    } else if (intent === "finance") {
      stream = financeAgentStream({ text, models, region });
    } else {
      // English Comments: Generic agent stream (no web search in this path, for simplicity)
      stream = genericAgentStream({ text, models, region });
    }
    
    // 3. Yield chunks from the selected agent
    for await (const chunk of stream) {
        // We get raw JSON strings from the model (e.g., Anthropic's format)
        // We need to parse them to extract the *actual* text delta
        try {
            const parsedChunk = JSON.parse(chunk);
            let delta = "";

            // Handle different model chunk formats
            if (parsedChunk.type === "content_block_delta") {
                delta = parsedChunk.delta?.text || ""; // Anthropic
            } else if (parsedChunk.choices) {
                delta = parsedChunk.choices[0]?.delta?.content || ""; // Mistral
            } else if (parsedChunk.delta) {
                 delta = parsedChunk.delta; // Generic delta
            }

            if (delta) {
                 yield `data: ${JSON.stringify({ delta })}\n\n`;
            }

        } catch(e) {
            // Not a JSON chunk, maybe an error or malformed data
            logger.warn("Non-JSON chunk in stream:", chunk);
        }
    }

  } catch (e) {
      logger.error("Error during agent stream:", e);
      yield `data: ${JSON.stringify({ error: "Error during streaming" })}\n\n`;
  }
}