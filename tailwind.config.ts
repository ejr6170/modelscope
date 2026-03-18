import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        glass: {
          bg: "rgba(13, 14, 18, 0.82)",
          card: "rgba(255, 255, 255, 0.03)",
          border: "rgba(255, 255, 255, 0.08)",
          hover: "rgba(255, 255, 255, 0.06)",
        },
        code: {
          bg: "rgba(2, 4, 12, 0.50)",
          border: "rgba(255, 255, 255, 0.06)",
        },
        txt: {
          primary: "#f1f5f9",
          secondary: "rgba(255, 255, 255, 0.50)",
          tertiary: "rgba(255, 255, 255, 0.25)",
        },
        accent: {
          violet: "#c4b5fd",
          cyan: "#7dd3fc",
          amber: "#fbbf24",
          emerald: "#6ee7b7",
          red: "#fca5a5",
          blue: "#93c5fd",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Cascadia Code"', "monospace"],
      },
      animation: {
        "live-pulse": "live-pulse 2.5s ease-in-out infinite",
        "card-in": "card-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      },
      keyframes: {
        "live-pulse": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 6px rgba(52, 211, 153, 0.5)" },
          "50%": { opacity: "0.3", boxShadow: "0 0 10px rgba(52, 211, 153, 0.15)" },
        },
        "card-in": {
          from: { opacity: "0", transform: "translateY(10px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
