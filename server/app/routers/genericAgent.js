// Generic Agent – concise, factual
import { BedrockLLM } from "../services/bedrockClient.js";

const GEN_SYS = `You are a precise assistant. Be concise and explicit about assumptions.`;

// Original (non-streaming) function remains
export async function genericAgent({ text, models, region }) {
  const llm = new BedrockLLM({ modelId: process.env.BEDROCK_MODEL_GENERAL || models.general, region, temperature: 0.2, maxTokens: 700 });
  return llm.ask({ systemPrompt: GEN_SYS, userPrompt: text });
}

// New streaming function
export async function* genericAgentStream({ text, models, region }) {
  const llm = new BedrockLLM({ modelId: process.env.BEDROCK_MODEL_GENERAL || models.general, region, temperature: 0.2, maxTokens: 700 });
  // 'llm.askStream' is the function that already existed in bedrockClient.js
  for await (const chunk of llm.askStream({ systemPrompt: GEN_SYS, userPrompt: text })) {
    yield chunk;
  }
}