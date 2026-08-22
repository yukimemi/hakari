/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Every colour is a CSS variable so the light/dark switch happens in
      // one place (src/index.css) rather than in a `dark:` prefix on every
      // element.
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        sunk: "var(--panel-sunk)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        rule: "var(--rule)",
        "rule-strong": "var(--rule-strong)",
        needle: "var(--needle)",
        goal: "var(--goal)",
        warn: "var(--warn)",
      },
      fontFamily: {
        reading: ["Archivo", "Segoe UI", "system-ui", "sans-serif"],
        body: ["Noto Sans JP", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "var(--shadow)",
      },
      borderRadius: {
        panel: "14px",
      },
    },
  },
  plugins: [],
};
