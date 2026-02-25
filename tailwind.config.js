/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
      },
      colors: {
        ink: "#0d0f12",
        slate: "#1a1f26",
        steel: "#2e3742",
        mist: "#a9b3bf",
        neon: "#7dd3fc",
        ember: "#f59e0b",
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(255,255,255,0.08), 0 12px 30px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
}

