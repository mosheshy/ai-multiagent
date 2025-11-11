import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";

const theme = createTheme({
  palette: {
    mode: "light", // שנה ל-"dark" אם אתה מעדיף מצב כהה
    primary: {
      main: "#007aff",
    },
    background: {
      default: "#f5f6fa",
    },
  },
  shape: { borderRadius: 10 },
});

export default function App({ Component, pageProps }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline /> {/* resets default browser styles */}
      <Component {...pageProps} />
    </ThemeProvider>
  );
}
