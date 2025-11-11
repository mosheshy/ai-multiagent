import { useState } from "react";
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Paper,
  useTheme,
} from "@mui/material";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
  const theme = useTheme();

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
    <Container
      maxWidth="xs"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
      }}
    >
      <Paper
        elevation={6}
        sx={{
          p: 4,
          width: "100%",
          borderRadius: 3,
          backdropFilter: "blur(8px)",
          background:
            theme.palette.mode === "dark"
              ? "rgba(30,30,30,0.9)"
              : "rgba(255,255,255,0.8)",
        }}
      >
        <Typography
          variant="h5"
          component="h2"
          align="center"
          gutterBottom
          fontWeight="bold"
        >
          AI Assistant Login
        </Typography>

        <Box component="form" onSubmit={onSubmit} sx={{ mt: 2 }}>
          <TextField
            label="Email"
            type="email"
            variant="outlined"
            fullWidth
            margin="normal"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <TextField
            label="Password"
            type="password"
            variant="outlined"
            fullWidth
            margin="normal"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button
            type="submit"
            variant="contained"
            color="primary"
            fullWidth
            sx={{ mt: 2, py: 1.2, fontWeight: "bold" }}
          >
            Sign In
          </Button>
        </Box>
      </Paper>
    </Container>
  );
}
