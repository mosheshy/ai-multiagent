import { useEffect, useRef, useState } from "react";

export default function ChatBox() {
  // --- Component State ---

  // Stores the text currently being typed by the user
  const [input, setInput] = useState("");
  // Stores the list of all messages (from user, assistant, or system)
  const [messages, setMessages] = useState([]); // E.g., [{role: 'user', text: 'Hello!'}]
  // Tracks if a message is currently being streamed from the server
  const [sending, setSending] = useState(false);

  // --- Refs ---

  // Ref to the message list DOM element for scrolling
  const listRef = useRef(null);
  // Ref to the AbortController, allowing us to cancel an in-progress fetch request
  const streamRef = useRef(null);

  // --- Helper Functions ---

  /**
   * Smoothly scrolls the message list container to the bottom.
   */
  function scrollToBottom() {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }

  /**
   * Appends a new message object to the `messages` state array.
   * @param {object} msg - The message object (e.g., {role: 'user', text: 'Hi'})
   */
  function pushMessage(msg) {
    setMessages(prev => [...prev, msg]);
  }

  /**
   * Updates the 'text' content of the *last* message in the array.
   * This is used for streaming, to append new deltas to the assistant's response.
   * @param {string} text - The new, complete text for the last message.
   */
  function updateLastAssistant(text) {
    setMessages(prev => {
      // Safety check: do nothing if messages array is empty
      if (!prev.length) return prev;

      // Create a new array to avoid mutating state directly
      const out = [...prev];

      // Update the last element
      out[out.length - 1] = { role: "assistant", text };
      return out;
    });
  }

  /**
   * Handles the form submission to send a new message.
   * This function initiates a streaming SSE request to the server.
   */
  async function send(e) {
    // Prevent default form submission which reloads the page
    e?.preventDefault?.();

    // 1. Get the auth token from localStorage
    const token = localStorage.getItem("token");
    if (!token) {
      // This is a user-facing error, so an alert is acceptable here.
      alert("Please login first");
      return;
    }

    // 2. Get the user's prompt and validate it
    const prompt = input.trim();
    // Do not send if:
    // - The prompt is empty (just whitespace)
    // - A request is already in progress (`sending` is true)
    if (!prompt || sending) return;

    // 3. Abort any previous stream that might still be running
    streamRef.current?.abort();
    streamRef.current = null;

    // 4. Update UI:
    pushMessage({ role: "user", text: prompt });  // Show the user's message
    pushMessage({ role: "assistant", text: "" }); // Add an empty placeholder for the bot's reply
    setInput("");       // Clear the input field
    setSending(true);   // Set loading state (disables the 'Send' button)
    scrollToBottom();   // Scroll to the new messages

    // 5. Prepare the API request
    const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
    const controller = new AbortController();
    streamRef.current = controller; // Store the controller in the ref so 'cancel' can use it

    try {
      // 6. Make the fetch request to the streaming endpoint
      // Note: We send the token in *both* the query param and the Authorization header
      // for maximum compatibility with different server/proxy setups.
      const res = await fetch(`${API}/api/stream?q=${encodeURIComponent(prompt)}&token=${encodeURIComponent(token)}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "text/event-stream", // Specify we want a Server-Sent Events stream
        },
        signal: controller.signal, // Pass the AbortController's signal
      });

      // 7. Handle bad responses (e.g., 401 Unauthorized, 500 Server Error)
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText);
        cleanup(`HTTP ${res.status}: ${errText}`); // Use cleanup to show error and reset state
        return;
      }

      // 8. Process the streaming response (SSE)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ""; // Holds incomplete chunks of data
      let acc = "";    // Holds the accumulated text for the *current* response

      // Loop forever until the stream is done
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break; // The stream has ended

        // Add the new chunk of data to our buffer
        buffer += decoder.decode(value, { stream: true });

        // An SSE frame ends with two newlines ("\n\n")
        let sepIndex;
        while ((sepIndex = buffer.indexOf("\n\n")) >= 0) {
          // Get the complete frame
          const frame = buffer.slice(0, sepIndex).trim();
          // Keep the rest of the buffer for the next iteration
          buffer = buffer.slice(sepIndex + 2);

          // Ignore SSE comments (lines starting with ":")
          if (!frame || frame.startsWith(":")) continue;

          // Process "data:" lines
          if (frame.startsWith("data:")) {
            const jsonStr = frame.replace(/^data:\s?/, "");
            try {
              const data = JSON.parse(jsonStr);

              // A 'delta' is a new piece of text
              if (data.delta) {
                acc += data.delta;           // Add new text to the accumulator
                updateLastAssistant(acc);  // Update the UI with the full accumulated text
                scrollToBottom();            // Keep scrolling to the bottom
              }
              // Handle server-side errors sent over the stream
              if (data.error) {
                cleanup(data.error); // Show error and stop
                return;
              }
              // The server signals the end of the stream
              if (data.done) {
                cleanup(); // Finalize the stream
                return;
              }
            } catch {
              // Ignore frames that aren't valid JSON
            }
          }
        }
      }
      // If the stream ends without a `data: {"done": true}` message,
      // we still clean up gracefully.
      cleanup();

    } catch (err) {
      // Handle network errors or if the user aborted the request
      if (err.name === 'AbortError') {
        // This is expected if the user hits 'Cancel', do nothing special.
        // The 'cancel' function itself will handle the UI update.
      } else {
        // A real network error occurred
        cleanup("Connection error. Try again.");
      }
    }
  }

  /**
   * Manually cancels the in-flight streaming request.
   * Triggered by the "Cancel" button.
   */
  function cancel() {
    if (streamRef.current) {
      streamRef.current.abort(); // Abort the fetch request
      streamRef.current = null;
      setSending(false); // Reset loading state
      pushMessage({ role: "system", text: "Stopped." }); // Notify user
    }
  }

  /**
   * A special useEffect hook that runs only when the component unmounts.
   * This ensures that if the user navigates away, any in-progress
   * stream is automatically cancelled to prevent memory leaks.
   */
  useEffect(() => {
    // The function returned from useEffect is the "cleanup" function
    return () => {
      streamRef.current?.abort();
    };
  }, []); // The empty dependency array [] means this runs once on mount/unmount

  /**
   * Shared cleanup function to reset state after a stream finishes or errors.
   * @param {string} [note] - An optional system message to display (e.g., an error).
   */
  function cleanup(note) {
    streamRef.current?.abort(); // Ensure stream is aborted
    streamRef.current = null;
    setSending(false); // Reset loading state
    if (note) {
      pushMessage({ role: "system", text: note }); // Push an error/system message
    }
  }

  // --- Render JSX ---
  return (
    <div>
      {/* Message List Area */}
      <div
        ref={listRef}
        style={{ border: "1px solid #ddd", padding: 16, minHeight: 320, maxHeight: 480, overflow: "auto" }}
      >
        {messages.map((m, i) => (
          <div key={i} style={{ margin: "8px 0" }}>
            <b>{m.role}:</b> <span>{m.text}</span>
          </div>
        ))}
      </div>

      {/* Input Form */}
      <form onSubmit={send} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message…"
          style={{ flex: 1, padding: 8 }}
        />
        {/* The Send button is disabled if a request is 'sending' OR if the input is empty */}
        <button type="submit" disabled={sending || !input.trim()}>Send</button>

        {/* The Cancel button is only enabled while a request is 'sending' */}
        <button type="button" onClick={cancel} disabled={!sending}>Cancel</button>
      </form>
    </div>
  );
}