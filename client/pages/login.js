import { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

  async function onSubmit(e) {
    e.preventDefault();

    const res = await fetch(`${API}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const txt = await res.text();
      alert(`Login failed: ${res.status} ${txt}`);
      return;
    }

    const data = await res.json();
    if (data.token) {
      localStorage.setItem("token", data.token);
      window.location.href = "/";
    } else {
      alert(data.error || "Login failed");
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h2>Login</h2>
      <form onSubmit={onSubmit}>
        <input
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <button type="submit" style={{ width: "100%", padding: 8 }}>
          Sign in
        </button>
      </form>
    </div>
  );
}