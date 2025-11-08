// app/services/bedrockClient.js
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
// 'fromIni' is no longer needed, 'defaultProvider' is.
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { AwsClient } from "./AwsClient.js";

/**
 * Creates a credentials provider.
 * This function manually implements the SDK's *future* preferred logic:
 * 1. Check for static ENV VARS (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).
 * 2. If not found, fall back to the default provider (which will check AWS_PROFILE, etc.).
 * This resolves the "Multiple credential sources" warning.
 */
function getCredentialsProvider(profile) {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;

  // Always return a provider *function* so callers can uniformly call provider()
  if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
    // Prefer explicit static ENV credentials when provided to avoid the
    // "multiple credential sources detected" warning from the SDK.
    return async () => ({
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      sessionToken: AWS_SESSION_TOKEN || undefined,
    });
  }

  // Otherwise use the SDK's defaultProvider. Pass through a profile if one
  // was explicitly requested by the caller (helps avoid ambiguous resolution).
  const sdkProvider = defaultProvider(profile ? { profile } : {});

  // Wrap the SDK provider to ensure we always get a credentials object or
  // a clear error message. Some provider implementations throw obscure
  // smithy/property-provider errors; this wrapper normalizes them.
  return async () => {
    try {
      const creds = await sdkProvider();
      // Validate shape
      if (!creds || !creds.accessKeyId || !creds.secretAccessKey) {
        throw new Error('Resolved credentials are missing required fields');
      }
      return creds;
    } catch (e) {
      // Re-throw a clearer error while preserving the original message.
      const short = String(e?.message || e);
      throw new Error(`Failed to resolve AWS credentials via defaultProvider: ${short}`);
    }
  };
}


export class BedrockLLM {
  constructor({ modelId, region, temperature = 0.2, maxTokens = 1024, profile }) {
    this.modelId = modelId;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    // Prepare credentials provider and client. We keep a reference to the
    // provider so we can validate credentials before making calls.
    const useRegion = region || process.env.AWS_REGION || 'us-east-1';
    const awsClient = new AwsClient(useRegion, profile || process.env.AWS_PROFILE);
    const bedrock = awsClient.getClient();

    this._credentialsProvider = getCredentialsProvider(profile || process.env.AWS_PROFILE);
    this.client = bedrock;
    this.region = useRegion;
  }

  async ask({ systemPrompt = "", userPrompt }) {
    // Eagerly validate credentials to provide clearer errors when missing
    try {
      // Always call the provider function and validate returned creds.
      const provider = this._credentialsProvider;
      if (typeof provider !== 'function') {
        throw new Error('Internal error: credentials provider is not a function');
      }
      const creds = await provider();
      if (!creds || !creds.accessKeyId || !creds.secretAccessKey) {
        throw new Error('Resolved AWS credentials are invalid or incomplete');
      }
    } catch (credErr) {
      const hint = `Missing or invalid AWS credentials. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure a valid AWS_PROFILE in ~/.aws/credentials and ~/.aws/config. Original: ${credErr?.message || credErr}`;
      throw new Error(hint);
    }

    try {
      // Default path: use the Converse API for models that support it
      const cmd = new ConverseCommand({
        modelId: this.modelId,
        messages: [{ role: "user", content: [{ text: userPrompt }]}],
        system: systemPrompt ? [{ text: systemPrompt }] : [],
        inferenceConfig: { maxTokens: this.maxTokens, temperature: this.temperature },
      });
      const resp = await this.client.send(cmd);
      const parts = resp?.output?.message?.content || [];
      return parts.map(p => p.text || "").join("");
    } catch (err) {
      // If this is a Marketplace subscription / permission error, show
      // a clearer actionable message instead of the raw smithy stack.
      try {
        const name = err?.name || '';
        const msg = String(err?.message || '');
        if (name === 'AccessDeniedException' || /aws-marketplace:Subscribe/.test(msg)) {
          throw new Error('Access denied when calling the model. Your AWS account or IAM principal is not subscribed or authorized to use this Marketplace model. Subscribe to the model in AWS Marketplace (or have an admin grant aws-marketplace:Subscribe) and wait ~15 minutes, then retry.');
        }
        // Only map ValidationException if it's specifically about an *invalid model id*.
        if (name === 'ValidationException' && /provided model identifier is invalid/i.test(msg)) {
          throw new Error(`Invalid model identifier: ${this.modelId}. Verify the BEDROCK_MODEL_* environment variables or the model identifier in AWS Bedrock/Marketplace, ensure your account is subscribed to that model, and that the model is available in region ${this.region}.`);
        }
      } catch (mappedErr) {
        if (mappedErr instanceof Error) throw mappedErr;
      }

      // Fallback for models/APIs that don't support Converse: construct a vendor-specific payload
      const body = buildInvokePayload({
        modelId: this.modelId,
        systemPrompt,
        userPrompt,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      });
      const cmd = new InvokeModelCommand({
        modelId: this.modelId,
        body,
        contentType: "application/json",
        accept: "application/json",
      });
      const resp = await this.client.send(cmd);
      const txt = await streamToString(resp.body);
      try {
        const parsed = JSON.parse(txt);
        if (parsed?.output?.message?.content) return parsed.output.message.content.map(p => p.text || "").join("");
        if (parsed?.content) return parsed.content.map(p => p.text || "").join("");
        return txt;
      } catch { return txt; }
    }
  }

  // Optional: true server-side streaming from Bedrock
  async *askStream({ systemPrompt = "", userPrompt }) {
    const isAnthropic = /^anthropic\./i.test(this.modelId || '');
    let body;
    if (isAnthropic) {
      const anthropicVersion = process.env.BEDROCK_ANTHROPIC_VERSION || 'bedrock-2023-05-31';
      const payload = {
        anthropic_version: anthropicVersion,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: [
          { role: 'user', content: [ { type: 'text', text: userPrompt } ] }
        ]
      };
      if (systemPrompt) payload.system = systemPrompt;
      body = JSON.stringify(payload);
    } else {
      body = JSON.stringify({
        messages: [
          systemPrompt ? { role: "system", content: [{ type: "text", text: systemPrompt }] } : null,
          { role: "user", content: [{ type: "text", text: userPrompt }] },
        ].filter(Boolean),
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      });
    }

    const cmd = new InvokeModelWithResponseStreamCommand({
      modelId: this.modelId,
      body,
      contentType: "application/json",
      accept: "application/json",
    });

    const resp = await this.client.send(cmd);
    for await (const event of resp.body) {
      if (event.chunk) {
        const s = new TextDecoder().decode(event.chunk.bytes);
        yield s; // raw JSON chunk (provider-specific)
      }
    }
  }
}
 
async function streamToString(stream) {
  let data = "";
  for await (const ch of stream) data += Buffer.from(ch).toString("utf8");
  return data;
}

function buildInvokePayload({ modelId, systemPrompt, userPrompt, temperature, maxTokens }) {
  const anthropicVersion = process.env.BEDROCK_ANTHROPIC_VERSION || 'bedrock-2023-05-31';
  const isAnthropic = /^anthropic\./i.test(modelId || '');
  const isMistral = /^mistral\./i.test(modelId || '');

  if (isAnthropic) {
    const payload = {
      anthropic_version: anthropicVersion,
      max_tokens: maxTokens,
      temperature,
      messages: [
        {
          role: 'user',
          content: [ { type: 'text', text: userPrompt } ]
        }
      ]
    };
    if (systemPrompt) payload.system = systemPrompt;
    return JSON.stringify(payload);
  }

  // Mistral style (messages array; include system as first message if provided)
  if (isMistral) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userPrompt });
    return JSON.stringify({
      messages,
      temperature,
      max_tokens: maxTokens,
    });
  }

  // Generic OpenAI-like fallback
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  return JSON.stringify({ messages, temperature, max_tokens: maxTokens });
}
