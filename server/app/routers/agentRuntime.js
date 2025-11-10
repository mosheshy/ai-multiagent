import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import crypto from "crypto";

/**
 * Resolve AWS region with sane fallbacks.
 */
function resolveRegion(explicitRegion) {
  return (
    explicitRegion ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1"
  );
}

/**
 * Shape a clear, actionable error message for Agent Runtime failures.
 * The AWS SDK error objects can be noisy; this normalizes them.
 */
function mapAgentError(err, { agentId, agentAliasId, region }) {
  const code =
    err?.name ||
    err?.$metadata?.httpStatusCode ||
    err?.Code ||
    "AgentInvokeError";
  const msg = [
    `[Bedrock Agent Invoke] ${code}`,
    `region=${region}`,
    `agentId=${agentId}`,
    `agentAliasId=${agentAliasId}`,
    err?.message ? `message=${err.message}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const e = new Error(msg);
  e.cause = err;
  e.code = code;
  return e;
}

/**
 * Read the agent's completion stream fully and return a single string.
 * This is useful for non-streaming paths (e.g., REST endpoints that want a single payload).
 *
 * @param {Object} params
 * @param {string=} params.region - Optional explicit region
 * @param {string=} params.agentId - If not provided, will fallback to BEDROCK_CLASSIFY_AGENT_ID
 * @param {string=} params.agentAliasId - If not provided, will fallback to BEDROCK_CLASSIFY_ALIAS_ID
 * @param {string}  params.inputText - The user input text sent to the Agent
 * @param {string=} params.sessionId - Optional session id; random UUID will be used if omitted
 * @param {boolean=} params.enableTrace - When true, instruct the runtime to emit trace events
 * @param {AbortSignal=} params.signal - Optional AbortSignal for cancellation
 * @returns {Promise<string>}
 */
export async function invokeAgentText({
  region,
  agentId,
  agentAliasId,
  inputText,
  sessionId,
  enableTrace = false,
  signal,
}) {
  const useRegion = resolveRegion(region);
  const client = new BedrockAgentRuntimeClient({ region: useRegion });

  const realAgentId = agentId || process.env.BEDROCK_CLASSIFY_AGENT_ID;
  const realAliasId = agentAliasId || process.env.BEDROCK_CLASSIFY_ALIAS_ID;
  const sid =
    sessionId ||
    (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() % 1e9));

  const cmd = new InvokeAgentCommand({
    agentId: realAgentId,
    agentAliasId: realAliasId,
    sessionId: sid,
    inputText,
    ...(enableTrace ? { enableTrace: true } : {}),
  });

  try {
    const resp = await client.send(cmd, { abortSignal: signal });
    if (!resp?.completion) {
      // Some error responses do not include a completion stream.
      throw new Error("Agent response has no 'completion' stream.");
    }
    const td = new TextDecoder("utf-8");
    let full = "";

    // Drain the async iterator and concatenate all chunks into a single string
    for await (const ev of resp.completion) {
      // Normal content chunks
      if (ev?.chunk?.bytes) {
        full += td.decode(ev.chunk.bytes, { stream: true });
      }
      // Optional: access ev.trace here when enableTrace === true
      // if (ev?.trace) { /* debug/collect trace if you need it */ }
    }
    return full;
  } catch (err) {
    throw mapAgentError(err, {
      agentId: realAgentId,
      agentAliasId: realAliasId,
      region: useRegion,
    });
  }
}
/*
* @param {Object} params
 * @param {string=} params.region
 * @param {string=} params.agentId        // falls back to BEDROCK_CLASSIFY_AGENT_ID
 * @param {string=} params.agentAliasId   // falls back to BEDROCK_CLASSIFY_ALIAS_ID
 * @param {string}  params.inputText
 * @param {string=} params.sessionId
 * @param {boolean=} params.enableTrace   // if true, runtime may emit trace events
 * @param {AbortSignal=} params.signal
 * @yields {string}
 */
export async function* invokeAgentStream({
  region,
  agentId,
  agentAliasId,
  inputText,
  sessionId,
  enableTrace = false,
  signal,
}) {
  // --- 1) Resolve config & validate -----------------------------------------
  const useRegion = resolveRegion(region);
  const realAgentId = agentId || process.env.BEDROCK_CLASSIFY_AGENT_ID;
  const realAliasId = agentAliasId || process.env.BEDROCK_CLASSIFY_ALIAS_ID;

  if (!realAgentId || !realAliasId) {
    throw new Error(
      "invokeAgentStream: missing agentId/agentAliasId (set env BEDROCK_CLASSIFY_AGENT_ID / BEDROCK_CLASSIFY_ALIAS_ID or pass explicitly)."
    );
  }

  const sid =
    sessionId ||
    (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() % 1e9));

  const client = new BedrockAgentRuntimeClient({ region: useRegion });

  // --- 2) Build command ------------------------------------------------------
  const cmd = new InvokeAgentCommand({
    agentId: realAgentId,
    agentAliasId: realAliasId,
    sessionId: sid,
    inputText,
    ...(enableTrace ? { enableTrace: true } : {}),
  });

  // --- 3) Invoke & stream ----------------------------------------------------
  const td = new TextDecoder("utf-8");
  try {
    const resp = await client.send(cmd, { abortSignal: signal });

    // Some error responses do not include a completion stream.
    if (!resp?.completion) {
      throw new Error("Agent response has no 'completion' stream.");
    }

    for await (const ev of resp.completion) {
      // Respect cancellation promptly
      if (signal?.aborted) break;

      // Normal content bytes
      if (ev?.chunk?.bytes) {
        const text = td.decode(ev.chunk.bytes, { stream: true });
        if (text) yield text;
      }

      // Optional: traces are available when enableTrace === true.
      // We don't yield them here because the contract is "string only".
      // If you need traces, add a second generator that yields objects.
      // if (ev?.trace) { /* no-op or emit via a side-channel */ }
    }

    // Flush any buffered UTF-8 partial at the end
    const tail = td.decode();
    if (tail) yield tail;
  } catch (err) {
    // If request was aborted, exit quietly
    if (signal?.aborted && (err.name === "AbortError" || err.code === "AbortError")) {
      return;
    }
    throw mapAgentError(err, {
      agentId: realAgentId,
      agentAliasId: realAliasId,
      region: useRegion,
    });
  }
}