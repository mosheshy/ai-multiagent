// --- START DOTENV FIX ---
// We must load dotenv *before* any other imports that rely on environment variables
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Find the root directory (one level up from 'app') and load the .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

// --- END DOTENV FIX ---

// Now, all other imports will have access to process.env
import express from "express";
import cors from "cors";
import { childLogger } from "./utils/logger.js";
import { generateToken } from "./auth/jwt.js";
import { requireAuth } from "./auth/middleware.js";
// English Comments: Import both routing functions
import { routeAndAnswer, routeAndAnswerStream } from "./routers/routerAgent.js";
// dotenv.config(); // This is now at the top

const logger = childLogger("server");
const app = express();
// ... (rest of the file is identical to your "most up-to-date" version) ...
// ... (קטע זה נחתך לשם קיצור. שאר הקובץ זהה לגרסה המעודכנת שלך) ...
const PORT = process.env.PORT || 8000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const REGION = process.env.AWS_REGION || "us-east-1";

// Models configuration (unchanged)
const MODELS = {
  classify: process.env.BEDROCK_MODEL_CLASSIFY || "anthropic.claude-3-5-sonnet-20241022-v2:0",
  general:  process.env.BEDROCK_MODEL_GENERAL  || "anthropic.claude-3-5-sonnet-20241022-v2:0",
  code:     process.env.BEDROCK_MODEL_CODE     || "mistral.mistral-large-2407",
  finance:  process.env.BEDROCK_MODEL_FINANCE  || "anthropic.claude-3-5-sonnet-20241022-v2:0"
};

// --- MIDDLEWARE --- (unchanged)
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: false,
}));
app.options("*", cors({
  origin: FRONTEND_ORIGIN,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: false,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTES ---

// Health check (unchanged)
app.get("/health", (_req, res) => {
  logger.info("Health check OK");
  res.json({ ok: true });
});

// Demo login (unchanged)
app.post("/api/login", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "email required" });
  const token = generateToken({ id: "demo", email, name: "Demo User" });
  res.json({ token });
});

// JSON chat (unchanged) - uses the regular routeAndAnswer
app.post("/api/chat", requireAuth(), async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  try {
    logger.info("Received prompt:", prompt);
    const result = await routeAndAnswer({ text: prompt, models: MODELS, region: REGION });
    res.json(result);
  } catch (e) {
    logger.error("Agent error", e);
    res.status(500).json({ error: "Agent error" });
  }
});

// --- /api/stream - rewritten for true streaming ---
app.get("/api/stream", requireAuth(), async (req, res) => {
  const prompt = (req.query.q || "").toString();
  logger.info("Stream request received", { prompt });
  if (!prompt) return res.status(400).end();

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  // Flush the headers immediately to the browser
  res.flushHeaders();

  // Keep-alive ping every 15s
  const keepAlive = setInterval(() => {
    res.write(":\n\n");
  }, 15000);

  // Clean up resources when the client disconnects
  req.on("close", () => {
    clearInterval(keepAlive);
    logger.info("Client disconnected from stream.");
    res.end(); // Ensure the connection is closed
  });

  try {
    // --- Core of the change ---
    // English Comments: Call the new generator function
    const stream = routeAndAnswerStream({ text: prompt, models: MODELS, region: REGION });

    // English Comments: Loop over the stream - each `chunk` comes directly from Bedrock
    for await (const chunk of stream) {
      // English Comments: The chunk is already formatted as `data: {...}\n\n` by the router
      // We parse it to handle specific content types, like JSON deltas
      
      // Handle different chunk types (intent vs. delta)
      if (chunk.startsWith("data:")) {
        const rawJson = chunk.substring(5).trim();
        try {
          const parsed = JSON.parse(rawJson);
          if (parsed.delta) {
            // It's a text delta
            res.write(`data: ${JSON.stringify({ delta: parsed.delta })}\n\n`);
          } else if (parsed.intent) {
            // It's the intent object
            res.write(`data: ${JSON.stringify({ intent: parsed.intent })}\n\n`);
          } else if (parsed.error) {
             // It's an error object
            res.write(`data: ${JSON.stringify({ error: parsed.error })}\n\n`);
          } else if (parsed.done) {
             // It's a done object
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          } else {
            // Fallback for unexpected JSON structures
             res.write(chunk);
          }
        } catch (e) {
          // Not valid JSON, might be a text chunk from a model that doesn't wrap in JSON
          // Or it's a raw chunk that needs to be wrapped
           res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
        }
      } else if (chunk.startsWith(":")) {
         // It's a keep-alive, write it directly
         res.write(chunk);
      } else {
         // Fallback for any other text, wrap it as a delta
         res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
      }
    }
    // --- End of change ---

    // English Comments: Send a 'done' message that the client (ChatBox.js) understands
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    
  } catch (e) {
    logger.error("Stream route error", e);
    // English Comments: Send an error message in SSE format
    if (!res.headersSent) {
      res.status(500);
    }
    res.write(`data: ${JSON.stringify({ error: "Agent error" })}\n\n`);
  } finally {
    // English Comments: Clean up resources and close the connection
    clearInterval(keepAlive);
    res.end();
  }
});

// --- START SERVER --- (unchanged)
const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: PORT=${Number(PORT) + 1} npm run start`);
  } else {
    console.error("Server error:", err);
  }
});