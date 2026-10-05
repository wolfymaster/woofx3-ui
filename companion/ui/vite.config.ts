import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri serves the dev build from a fixed port (tauri.conf.json `devUrl`), so
// the port is strict rather than falling forward to the next free one.
export default defineConfig({
  root: import.meta.dirname,
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
    outDir: path.resolve(import.meta.dirname, "../dist"),
    emptyOutDir: true,
  },
});
