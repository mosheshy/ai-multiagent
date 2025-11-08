// backend/app/routers/financeAgent.js
import { BedrockLLM } from "../services/bedrockClient.js";
import { fxGetRate, calcFees } from "../services/tools.finance.js";

const FIN_SYS = `You are an educational financial assistant (not investment advice).
Output structure:
1) Summary
2) Analysis (assumptions, risks, fees, taxes)
3) Checklist
4) Example
5) Limitations
Rules:
- Be concise, risk-aware, and neutral.
- Never give direct investment instructions; use scenarios.
- If user asks about currency or fees, compute with the provided tool results.
`;

export async function financeAgent({ text, models, region }) {
  const modelId = process.env.BEDROCK_MODEL_FINANCE || models.finance;
  const llm = new BedrockLLM({
    modelId,
    region,
    temperature: Number(process.env.FIN_TEMP || 0.3),
    maxTokens: Number(process.env.FIN_MAX_TOKENS || 900),
  });

  // Simple tool hinting: detect if user mentions FX or fees and enrich context.
  let toolContext = "";
  try {
    // naive triggers; replace with your classifier if you want
    const t = text.toLowerCase();
    if (t.includes("usd") || t.includes("eur") || t.includes("ils") || t.includes("שקל") || t.includes("דולר") || t.includes("יורו")) {
      const rate = await fxGetRate("USD", "ILS"); // demo default
      toolContext += `\nFX Example USD->ILS: ${rate?.rate ?? "N/A"} (source: demo)\n`;
    }
    if (t.includes("עמלות") || t.includes("fees") || t.includes("commission")) {
      const feeInfo = calcFees({ amount: 1000, percent: 0.3, min: 5 });
      toolContext += `Fees Example on 1000: total=${feeInfo.total}, breakdown=${JSON.stringify(feeInfo)}\n`;
    }
  } catch {}

  const userPrompt = [
    "User request:",
    "```",
    text,
    "```",
    toolContext ? `\nAvailable tool context:\n${toolContext}` : "",
    "\nAdd a brief 'not investment advice' disclaimer at the end."
  ].join("\n");

  return llm.ask({ systemPrompt: FIN_SYS, userPrompt });
}
