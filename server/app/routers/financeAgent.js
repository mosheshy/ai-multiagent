import { invokeAgentText, invokeAgentStream } from "./agentRuntime.js";
import { BedrockLLM } from "../services/bedrockClient.js";
import { fxGetRate, calcFees } from "../services/tools.finance.js";

const FIN_SYS = `
You are an educational financial assistant. You provide explanations and educational scenarios only — not investment advice.

You MUST always respond in the following structure and with the exact headings:
1) Summary
2) Analysis (assumptions, risks, fees, and taxes)
3) Checklist
4) Example
5) Limitations

Rules:
- Be concise, factual, and risk-aware.
- Remain neutral and avoid personal recommendations.
- Never tell the user to buy, sell, or convert; use hypothetical examples instead.
- When the user asks about currencies or fees, use provided tool outputs for calculations; do not invent numbers.
- If data is missing, state assumptions clearly and label them as assumptions.
- Keep tone professional, accessible, and educational.
- End with a short "This is educational information, not investment advice." disclaimer.
`;

function clamp01(x, def = 0.5) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : def;
}

function safeStr(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

// Very light extraction to guess currencies and amounts from the user text.
// This is intentionally conservative and falls back to sensible defaults.
function inferFxIntent(raw) {
  const text = String(raw || "").toUpperCase();

  // Try to find two currency codes (USD/EUR/ILS/etc.)
  const codes = [...text.matchAll(/\b([A-Z]{3})\b/g)].map(m => m[1]);
  let from = null, to = null;
  // Common words in Hebrew/English mapped to codes
  const synonyms = [
    ["שקל", "ILS"], ["שקלים", "ILS"], ["NIS", "ILS"], ["ILS", "ILS"],
    ["דולר", "USD"], ["DOLLAR", "USD"], ["USD", "USD"],
    ["אירו", "EUR"], ["יורו", "EUR"], ["EURO", "EUR"], ["EUR", "EUR"],
    ["GBP", "GBP"]
  ];
  for (const [word, code] of synonyms) {
    if (text.includes(word)) codes.push(code);
  }

  // Heuristic: take first two distinct codes found
  for (const c of codes) {
    if (!from) { from = c; continue; }
    if (!to && c !== from) { to = c; break; }
  }

  // Try to detect a percent and a base amount (e.g., "30% of 20,000")
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const amountMatch = text.match(/(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)/); // naive first number

  const percent = percentMatch ? Number(percentMatch[1]) : null;
  const amount = amountMatch ? Number(amountMatch[1].replace(/[,\s]/g, "")) : null;

  return {
    // Default pair if we couldn't infer
    from: from || "USD",
    to: to || "ILS",
    percent,   // may be null
    amount     // may be null
  };
}

// Build a single, consistent user prompt for both streaming and non-streaming
function buildUserPrompt({ userText, toolContext }) {
  return [
    "User request:",
    "```",
    safeStr(userText),
    "```",
    toolContext ? `\nAvailable tool context:\n${toolContext}` : "",
    "\nFollow the required section headings exactly. Add a brief 'This is educational information, not investment advice.' disclaimer at the end."
  ].join("\n");
}

// Add minimal tool-derived context if it looks relevant
async function buildToolContext(text) {
  const t = String(text || "").toLowerCase();
  let out = "";

  // Decide if user likely asked about FX
  const mentionsFX =
    t.includes("usd") || t.includes("eur") || t.includes("ils") ||
    t.includes("שקל") || t.includes("דולר") || t.includes("יורו") ||
    t.includes("exchange") || t.includes("convert") || t.includes("currency");

  // Decide if user mentioned fees
  const mentionsFees =
    t.includes("עמלות") || t.includes("fees") || t.includes("commission") || t.includes("spread");

  // Try to infer currencies/amounts and fetch a real demo rate
  if (mentionsFX) {
    const guess = inferFxIntent(text);
    try {
      const rateResp = await fxGetRate(guess.from, guess.to); // expected { rate }
      if (rateResp?.rate) {
        out += `FX Example ${guess.from}->${guess.to}: ${rateResp.rate} (source: tool)\n`;
      } else {
        out += `FX Example ${guess.from}->${guess.to}: N/A (tool returned no rate)\n`;
      }
    } catch {
      out += `FX Example (tool error): N/A\n`;
    }
  }

  if (mentionsFees) {
    // Default demo calc for transparency; model must treat these as examples only
    try {
      const feeInfo = calcFees({ amount: 1000, percent: 0.3, min: 5 });
      out += `Fees Example (amount=1000, pct=0.3%, min=5): total=${feeInfo.total}, breakdown=${safeStr(feeInfo)}\n`;
    } catch {
      out += `Fees Example: N/A (tool error)\n`;
    }
  }

  return out.trim();
}

// --------------------------- Core: Non-Streaming ------------------------------
export async function financeAgent({ text, models, region }) {
  const modelId = process.env.BEDROCK_MODEL_FINANCE || models.finance;
  const agentId = process.env.BEDROCK_FINANCE_AGENT_ID;
  const aliasId = process.env.BEDROCK_FINANCE_AGENT_ALIAS_ID;
  let answer;
  if (agentId && aliasId) {
    // Use Bedrock Agent Runtime for a single-shot response (non-streaming)
    try {
      answer = await invokeAgentText({
        region,
        agentId,
        agentAliasId: aliasId,
        inputText: text
      });
    } catch (e) {
      // Fallback to model if agent invocation fails
      const llm = new BedrockLLM({
        modelId,
        region,
        temperature: Number(process.env.FIN_TEMP ?? 0.3),
        maxTokens: Number(process.env.FIN_MAX_TOKENS ?? 900)
      });
      const toolContext = await buildToolContext(text);
      const userPrompt = buildUserPrompt({ userText: text, toolContext });
      answer = await llm.ask({ systemPrompt: FIN_SYS, userPrompt });
    }
  } else {
    const llm = new BedrockLLM({
      modelId,
      region,
      temperature: Number(process.env.FIN_TEMP ?? 0.3),
      maxTokens: Number(process.env.FIN_MAX_TOKENS ?? 900)
    });
    const toolContext = await buildToolContext(text);
    const userPrompt = buildUserPrompt({ userText: text, toolContext });
    answer = await llm.ask({ systemPrompt: FIN_SYS, userPrompt });
  }

  // Normalize output to string
  if (typeof answer === "string") {
    return answer.replace(/\[object Object\]/g, "").trim();
  }
  try {
    return JSON.stringify(answer);
  } catch {
    return String(answer ?? "").trim();
  }
}

// --------------------------- Core: Streaming ---------------------------------
export async function* financeAgentStream({ text, models, region, signal }) {
  // Resolve model + region safely
  const useRegion =
    region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const modelId = process.env.BEDROCK_MODEL_FINANCE || models?.finance;

  const agentId  = process.env.BEDROCK_FINANCE_AGENT_ID;
  const aliasId  = process.env.BEDROCK_FINANCE_AGENT_ALIAS_ID;

  // 1) Try Agent first (if configured)
  if (agentId && aliasId) {
    try {
      for await (const piece of invokeAgentStream({
        region: useRegion,
        agentId,
        agentAliasId: aliasId,
        inputText: text,
        signal,
      })) {
        if (signal?.aborted) return; // stop early if cancelled
        yield piece;
      }
      return; // agent path succeeded → we're done
    } catch (e) {
      // Be verbose in dev, concise in prod
      const msg = `[financeAgentStream] Agent invoke failed → falling back to model. ${String(e?.message || e)}`;
      if (process.env.NODE_ENV !== "production") {
        console.warn(msg, { error: e });
      } else {
        console.warn(msg);
      }
      // fall through to model streaming
    }
  }

  // 2) Fallback: direct model streaming
  if (!modelId) {
    throw new Error(
      "financeAgentStream: No modelId resolved (set BEDROCK_MODEL_FINANCE or provide models.finance)."
    );
  }

  const llm = new BedrockLLM({
    modelId,
    region: useRegion,
    // FIX: spelling + robust number parsing
    temperature: Number.isFinite(Number(process.env.FIN_TEMP))
      ? Number(process.env.FIN_TEMP)
      : 0.3,
    maxTokens: Number.isFinite(Number(process.env.FIN_MAX_TOKENS))
      ? Number(process.env.FIN_MAX_TOKENS)
      : 900,
  });

  try {
    const toolContext = await buildToolContext(text);
    const userPrompt = buildUserPrompt({ userText: text, toolContext });

    for await (const chunk of llm.askStream({
      systemPrompt: FIN_SYS,
      userPrompt,
      signal,
    })) {
      if (signal?.aborted) return;
      yield chunk;
    }
  } catch (e) {
    // Surface a clear error to the caller
    const code = e?.name || e?.code || "FinanceStreamError";
    const err = new Error(`[financeAgentStream] ${code}: ${e?.message || e}`);
    err.code = code;
    err.cause = e;
    throw err;
  }
}


