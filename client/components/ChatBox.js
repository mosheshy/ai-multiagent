// components/ChatBox.js
import { useEffect, useRef, useState } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Stack,
  Paper,
  TextField,
  Button,
  Tooltip,
  CircularProgress,
  Chip,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import StopCircleIcon from "@mui/icons-material/StopCircle";

/**
 * ChatBox (Material UI)
 * - Professional layout with AppBar, bubbles, and sticky input.
 * - SSE streaming with whitespace preserved (no trim on deltas).
 * - Cancel in-flight stream safely.
 */
export default function ChatBox() {
  // --- State ---
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]); // [{role: 'user'|'assistant'|'system', text: string}]
  const [sending, setSending] = useState(false);
  const [agent, setAgent] = useState(null); 
  // --- Refs ---
  const listRef = useRef(null);
  const streamRef = useRef(null); // AbortController for the current stream

  // --- Helpers ---
  function scrollToBottom() {
    if (!listRef.current) return;
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }

  function pushMessage(msg) {
    setMessages((prev) => [...prev, msg]);
  }

  function updateLastAssistant(text) {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const out = [...prev];
      out[out.length - 1] = { role: "assistant", text };
      return out;
    });
  }

  // --- Core: send + stream via SSE (Fetch streaming) ---
  async function send(e) {
    e?.preventDefault?.();

    const token = localStorage.getItem("token");
    if (!token) {
      alert("Please login first");
      return;
    }

    const prompt = input.trim();
    if (!prompt || sending) return;

    // Abort any previous stream
    streamRef.current?.abort();
    streamRef.current = null;

    // UI bootstrap
    pushMessage({ role: "user", text: prompt });
    pushMessage({ role: "assistant", text: "" }); // placeholder for streamed answer
    setInput("");
    setSending(true);
    scrollToBottom();

    const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
    const controller = new AbortController();
    streamRef.current = controller;

    try {
      const res = await fetch(
        `${API}/api/stream?q=${encodeURIComponent(prompt)}&token=${encodeURIComponent(
          token
        )}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        }
      );

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => res.statusText);
        cleanup(`HTTP ${res.status}: ${txt}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ""; // raw SSE text buffer
      let acc = ""; // accumulated assistant text
      let intentShown = false;
      // Read the stream forever until done/aborted
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE frames delimited by \n\n
        for (let sep = buffer.indexOf("\n\n"); sep >= 0; sep = buffer.indexOf("\n\n")) {
          // DO NOT trim the whole frame (would crush whitespace).
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          // Ignore comments (lines starting with ":")
          const isComment = frame.startsWith(":");
          if (isComment || frame.length === 0) continue;

          // Each frame may have multiple "data:" lines; join them.
          // We only care about lines beginning with "data:".
          const dataLines = frame
            .split("\n")
            .filter((ln) => ln.startsWith("data:"))
            .map((ln) => ln.replace(/^data:\s?/, "")); // remove only the "data:" prefix

          if (!dataLines.length) continue;

          // Join lines to form a single JSON string; no trimming of content itself.
          const jsonStr = dataLines.join("\n");

          try {
            const payload = JSON.parse(jsonStr);
            if (payload.intent) {
    pushMessage({
      role: "system",
      text: `→ ${payload.agentName || payload.intent} handling your request...`,
    });
  }

            if (payload.delta !== undefined) {
              // Preserve whitespace; do not trim.
              const delta = String(payload.delta)
                // strip zero-width/control chars but keep spaces/newlines
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
              acc += delta;
              updateLastAssistant(acc);
              scrollToBottom();
            }
            if (payload.error) {
              cleanup(String(payload.error));
              return;
            }
            if (payload.done) {
              cleanup();
              return;
            }
          } catch {
            // Ignore non-JSON frames
          }
        }
      }

      // Graceful end if server didn’t send {done:true}
      cleanup();
    } catch (err) {
      if (err?.name !== "AbortError") {
        cleanup("Connection error. Try again.");
      }
    }
  }

  function cancel() {
    streamRef.current?.abort();
    streamRef.current = null;
    setSending(false);
    pushMessage({ role: "system", text: "Stopped." });
  }

  function cleanup(note) {
    streamRef.current?.abort();
    streamRef.current = null;
    setSending(false);
    if (note) pushMessage({ role: "system", text: note });
  }

  // Abort in-flight stream on unmount
  useEffect(() => () => streamRef.current?.abort(), []);

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- Render ---
  return (
    <Box
      sx={{
        height: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        bgcolor: (t) => t.palette.mode === "dark" ? "background.default" : "#f5f6fa",
      }}
    >
      {/* Top Bar */}
      <AppBar position="sticky" elevation={1} color="default">
        <Toolbar>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            AI Assistant
          </Typography>
        </Toolbar>
        <Toolbar sx={{ display: "flex", gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
            AI Assistant
          </Typography>
          {agent && (
           <Chip
              label={agent}
              size="small"
             color="primary"
              variant="outlined"
              sx={{ fontWeight: 600 }}
           />
          )}
        </Toolbar>
        
      </AppBar>

      {/* Messages area */}
      <Box
        ref={listRef}
        sx={{
          overflowY: "auto",
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
        }}
      >
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          const isAssistant = m.role === "assistant";
          const isSystem = m.role === "system";

          return (
            <Stack
              key={i}
              direction="row"
              justifyContent={isUser ? "flex-end" : "flex-start"}
            >
              <Paper
                elevation={0}
                sx={{
                  px: 1.75,
                  py: 1.25,
                  maxWidth: "75ch",
                  borderRadius: 3,
                  borderTopRightRadius: isUser ? 4 : 12,
                  borderTopLeftRadius: isUser ? 12 : 4,
                  bgcolor: isUser ? "primary.main" : isSystem ? "warning.light" : "grey.200",
                  color: isUser ? "primary.contrastText" : "text.primary",
                  border: isSystem ? "1px solid" : "none",
                  borderColor: isSystem ? "warning.main" : "transparent",
                  whiteSpace: "pre-wrap", // preserve spaces/newlines from streaming
                  wordBreak: "break-word",
                }}
              >
                {isAssistant && !m.text && sending ? (
                  // Typing indicator while assistant text is empty and sending
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <CircularProgress size={16} />
                    <Typography variant="body2">typing…</Typography>
                  </Stack>
                ) : (
                  <Typography variant="body1">{m.text}</Typography>
                )}
              </Paper>
            </Stack>
          );
        })}
      </Box>

      {/* Input area */}
      <Box
        component="form"
        onSubmit={send}
        sx={{
          p: 1.5,
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 1,
          borderTop: (t) => `1px solid ${t.palette.divider}`,
          bgcolor: "background.paper",
        }}
      >
        <TextField
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          size="medium"
          fullWidth
          disabled={sending}
        />

        <Tooltip title="Send">
          <span>
            <Button
              type="submit"
              variant="contained"
              startIcon={<SendIcon />}
              disabled={sending || !input.trim()}
              sx={{ px: 2.5 }}
            >
              Send
            </Button>
          </span>
        </Tooltip>

        <Tooltip title="Cancel">
          <span>
            <Button
              type="button"
              variant="outlined"
              color="error"
              startIcon={<StopCircleIcon />}
              onClick={cancel}
              disabled={!sending}
              sx={{ px: 2.5 }}
            >
              Cancel
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
