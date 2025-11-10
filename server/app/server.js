// --- START DOTENV FIX ---
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Load .env from the project root (one level up from /app)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
// --- END DOTENV FIX ---

// Core & middleware
import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import crypto from "crypto";
import { performance } from "perf_hooks";

// App modules
import { childLogger } from "./utils/logger.js";
import { generateToken } from "./auth/jwt.js";
import { requireAuth } from "./auth/middleware.js";
import { routeAndAnswer, routeAndAnswerStream } from "./routers/routerAgent.js";

// Optional: model registry route (remove if not used)
import { listAvailableModels } from "./services/modelRegistry.js";

const logger = childLogger("server");
const app = express();

/* -------------------- Utilities -------------------- */
/**
 * Normalize env strings to remove stray quotes and zero-width spaces.
 * This prevents errors like "Invalid model identifier" caused by copy/paste.
 */
function normalize(str) {
  return String(str ?? "")
    .replace(/\u200B/g, "")             // zero-width chars
    .replace(/^['"\s]+|['"\s]+$/g, "")  // surrounding quotes/spaces
    .trim();
}

/**
 * Clean a *full* paragraph/answer before returning in non-streaming responses.
 * Keep newlines and single spaces. Do not crush content structure.
 */
function cleanBlock(s) {
  return String(s)
    .replace(/\[object Object\]/g, "")
    // collapse only tabs into a single space, keep spaces/newlines as-is:
    .replace(/\t+/g, " ")
    // remove control characters except \n and \r:
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/**
 * Clean *stream deltas* without touching spaces/newlines.
 * Never trim—models often send leading spaces as part of the token.
 */
function cleanDelta(s) {
  return String(s)
    .replace(/\[object Object\]/g, "")
    // strip zero-width chars; keep all visible whitespace
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // remove control characters except \n and \r:
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/* -------------------- 1) Config & validation -------------------- */
const PORT = Number(process.env.PORT) || 8000;
const FRONTEND_ORIGIN = normalize(process.env.FRONTEND_ORIGIN || "http://localhost:3000");
const REGION =
  normalize(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1");

// Centralized models config; adjust model IDs to your Bedrock access
const MODELS = {
  classify: normalize(process.env.BEDROCK_MODEL_CLASSIFY || "anthropic.claude-3-5-sonnet-20241022-v2:0"),
  general:  normalize(process.env.BEDROCK_MODEL_GENERAL  || "anthropic.claude-3-5-sonnet-20241022-v2:0"),
  code:     normalize(process.env.BEDROCK_MODEL_CODE     || "mistral.mistral-large-2407"),
  finance:  normalize(process.env.BEDROCK_MODEL_FINANCE  || "anthropic.claude-3-5-sonnet-20241022-v2:0"),
};

// Quick boot log (avoid printing secrets)
logger.info("Boot config", { PORT, REGION, FRONTEND_ORIGIN, MODELS });

/* -------------------- 2) Security & performance middlewares -------------------- */
app.set("trust proxy", true); // set true if behind proxy/load balancer

// Secure headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // allow images/fonts from other origins if needed
}));

// Compression: DO NOT compress SSE (it breaks streaming on some proxies)
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.path === "/api/stream") return false;
    return compression.filter(req, res);
  }
}));

// Body parsers with safe limits
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// CORS (expose minimal headers needed for SSE/Fetch)
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  exposedHeaders: ["Content-Type", "Cache-Control", "X-Request-Id"],
  credentials: false,
}));

// Lightweight request id & timing logs
app.use((req, res, next) => {
  const rid = crypto.randomUUID();
  const start = performance.now();
  res.setHeader("X-Request-Id", rid);
  // @ts-ignore - augmenting Express req object
  req.id = rid;

  res.on("finish", () => {
    const ms = Math.round(performance.now() - start);
    logger.info("HTTP", { id: rid, method: req.method, path: req.originalUrl, status: res.statusCode, ms });
  });
  next();
});

/* -------------------- 3) Routes -------------------- */
// Health & readiness
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/livez", (_req, res) => res.status(200).end("OK"));
app.get("/readyz", (_req, res) => res.status(200).end("READY"));
app.get("/version", (_req, res) => res.json({ version: process.env.APP_VERSION || "dev" }));

// Optional: list Bedrock models (remove if not implemented)
app.get("/api/models", requireAuth(), async (_req, res, next) => {
  try {
    const list = await listAvailableModels(REGION);
    res.json(list);
  } catch (e) {
    // You can return 501 instead if the registry is not implemented:
    // return res.status(501).json({ error: "Not implemented" });
    next(e);
  }
});

// Demo login -> issues a JWT (do not use as-is in production)
app.post("/api/login", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "email required" });
  const token = generateToken({ id: "demo", email, name: "Demo User" });
  res.json({ token });
});

// Non-streaming chat: returns { intent, answer }
app.post("/api/chat", requireAuth(), async (req, res, next) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const result = await routeAndAnswer({
      text: String(prompt),
      models: MODELS,
      region: REGION
    });

    res.json({
      intent: result.intent,                 // "code" | "finance" | "general"

      answer: cleanBlock(result.answer)
    });
  } catch (e) {
    next(e);
  }
});

// Streaming chat via Server-Sent Events (SSE)
app.get("/api/stream", requireAuth(), async (req, res, _next) => {
  const prompt = String(req.query.q || "");
  if (!prompt) return res.status(400).end();

  // SSE headers: avoid buffering and proxy transformations
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // for Nginx (disables buffering)
  res.write(`retry: 5000\n\n`); // client auto-reconnect after 5s
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  // Abort downstream work when client disconnects
  const ac = new AbortController();
  const { signal } = ac;

  // Keep-alive comment every 15s (valid SSE "comment" frame)
  const keepAlive = setInterval(() => res.write(`: keep-alive\n\n`), 15000);

  const cleanup = () => {
    clearInterval(keepAlive);
    ac.abort();
    try { res.end(); } catch {}
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);

  try {
    // routeAndAnswerStream MUST be an async generator yielding:
    // { type: "intent"|"delta"|"error"|"done", ... }
    const stream = routeAndAnswerStream({
      text: prompt,
      models: MODELS,
      region: REGION,
      signal
    });

    let sentDone = false;

    for await (const msg of stream) {
      if (!msg || typeof msg !== "object") continue;

     if (msg.type === "intent") {
  res.write(`data: ${JSON.stringify({
    intent: msg.intent || "general",
    agentName: msg.agentName || null
  })}\n\n`);

} else if (msg.type === "delta") {
        // IMPORTANT: do not trim or collapse spaces/newlines in deltas
        const text = cleanDelta(String(msg.delta ?? ""));
        // Only skip empty strings; preserve all whitespace content
        if (text !== "") {
          res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
        }
      } else if (msg.type === "error") {
        res.write(`data: ${JSON.stringify({ error: String(msg.error || "stream error") })}\n\n`);
      } else if (msg.type === "done") {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        sentDone = true;
      }
    }

    // Ensure a final done frame
    if (!sentDone) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    }
  } catch (err) {
    logger.error("Stream route error", { /* @ts-ignore */ id: req.id, err: err?.message });
    // Headers already sent in SSE; emit an error frame instead of changing status
    try { res.write(`data: ${JSON.stringify({ error: "Agent error" })}\n\n`); } catch {}
  } finally {
    cleanup();
  }
});

/* -------------------- 4) Central error handler -------------------- */
app.use((err, req, res, _next) => {
  const status = Number(err?.status || 500);
  const msg = String(err?.message || "Internal error");
  // @ts-ignore
  logger.error("Unhandled error", { id: req.id, status, msg });
  if (res.headersSent) return; // if SSE already flowing
  res.status(status).json({ error: msg });
});

/* -------------------- 5) Start & graceful shutdown -------------------- */
const server = app.listen(PORT, () => {
  logger.info(`API listening on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: PORT=${Number(PORT) + 1} npm run start`);
  } else {
    console.error("Server error:", err);
  }
});

function shutdown(signal) {
  logger.warn(`Received ${signal}, shutting down...`);
  server.close((err) => {
    if (err) {
      logger.error("Error on close", err);
      process.exit(1);
    }
    logger.info("HTTP server closed. Bye.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
