import { useEffect, useState } from "react";
import ChatBox from "../components/ChatBox";
import Login from "./login";
import { useRouter } from "next/router";

export default function Home() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const t = localStorage.getItem("token");
    setAuthed(!!t);
    setReady(true);
    if (!t) router.replace("/login");
  }, [router]); // Added router to dependency array

  if (!ready) return null;

  return authed ? (
    <main style={{ maxWidth: 768, margin: "20px auto", padding: "0 16px", fontFamily: "sans-serif" }}>
      <div style={{display:"flex",justifyContent:"space-between",padding:16}}>
        <h2>AI Assistant</h2>
      </div>
      <ChatBox />
    </main>
  ) : (
    <Login />
  );
}