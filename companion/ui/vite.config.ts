import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The companion window is the app's second window, served under /companion/
// beside the dashboard: from the bundle in a build, and in dev through the
// dashboard's dev server, which proxies /companion to this one. Both ports
// are fixed (tauri.conf.json `devUrl`, the proxy in the root vite.config.ts),
// so they are strict rather than falling forward to the next free one.
const COMPANION_BASE = "/companion/";

export default defineConfig({
  root: import.meta.dirname,
  base: COMPANION_BASE,
  plugins: [react()],
  clearScreen: false,
  // The companion's CSS is plain. An inline config stops Vite searching up to
  // the dashboard's postcss.config.js, whose Tailwind plugin the companion
  // doesn't install.
  css: {
    postcss: {},
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "../dist/companion"),
    emptyOutDir: true,
  },
});
