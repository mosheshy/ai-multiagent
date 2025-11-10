// app/services/bedrockClient.js
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Helper to normalize model IDs and remove stray quotes or spaces.
 */
function normalizeModelId(id) {
  return String(id ?? "")
    .replace(/\u200B/g, "")
    .replace(/^[\'\"\s]+|[\'\"\s]+$/g, "")
    .trim();
}

/**
 * BedrockLLM - universal wrapper for Bedrock foundation models using the Converse API.
 * Supports both full-response and streaming modes.
 */
export class BedrockLLM {
  constructor({ modelId, region, temperature = 0.2, maxTokens = 1024, topP = 0.9, stop = [] }) {
    this.modelId = normalizeModelId(modelId);
    this.region = region;
    this.temperature = Number(temperature);
    this.maxTokens = Number(maxTokens);
    this.topP = Number(topP);
    this.stop = Array.isArray(stop) ? stop : [];
    this.client = new BedrockRuntimeClient({ region: this.region });
  }

  
  buildConverseInput({ systemPrompt, userPrompt }) {
    const input = {
      modelId: this.modelId,
      // Optional system prompt at the top level
      ...(systemPrompt ? { system: [{ text: systemPrompt }] } : {}),
      messages: [
        {
          role: "user",
          content: [{ text: String(userPrompt ?? "") }],
        },
      ],
      inferenceConfig: {
        maxTokens: this.maxTokens,
        temperature: this.temperature,
        topP: this.topP,
        ...(this.stop.length ? { stopSequences: this.stop } : {}),
      },
    };
    return input;
  }

  
  async ask({ systemPrompt, userPrompt, signal }) {
    const input = this.buildConverseInput({ systemPrompt, userPrompt });
    const cmd = new ConverseCommand(input);
    const resp = await this.client.send(cmd, { abortSignal: signal });

    // Extract all text parts from the response
    let text = "";
    for (const block of resp.output?.message?.content ?? []) {
      if (block.text) text += block.text;
    }
    return text.trim();
  }

  /**
   * Streaming version (yields text chunks as they arrive)
   */
  async *askStream({ systemPrompt, userPrompt, signal }) {
    const input = this.buildConverseInput({ systemPrompt, userPrompt });
    const cmd = new ConverseStreamCommand(input);
    const resp = await this.client.send(cmd, { abortSignal: signal });

    for await (const event of resp.stream) {
      if (event.contentBlockDelta?.delta?.text) {
        yield event.contentBlockDelta.delta.text;
      } else if (event.error) {
        throw new Error(event.error.message || "provider stream error");
      }
    }
  }
}
