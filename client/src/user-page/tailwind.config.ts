import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";

/**
 * The user page's own Tailwind build, so its stylesheet carries only the
 * classes the page uses. Colours are the tokens in styles.css; `accent` is the
 * owner's preset, set on the page shell by accentStyle (theme.ts).
 */
export default {
  darkMode: "media",
  content: { relative: true, files: ["./index.html", "./**/*.tsx"] },
  theme: {
    extend: {
      colors: {
        paper: "rgb(var(--paper) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "on-accent": "rgb(var(--on-accent) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["InterVariable", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [typography],
} satisfies Config;
