import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { userPageDevPort } from "./client/src/user-page/build/dev-server";

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) => m.cartographer()),
          await import("@replit/vite-plugin-dev-banner").then((m) => m.devBanner()),
        ]
      : []),
  ],
  resolve: {
    // Order matters: more-specific entries must come before less-specific
    // prefixes, otherwise vite's prefix matcher rewrites `@woofx3/api/client`
    // to `<api-dir>.ts/client` (which never resolves).
    alias: [
      { find: /^@\/(.*)$/, replacement: path.resolve(import.meta.dirname, "client", "src") + "/$1" },
      { find: /^@assets\/(.*)$/, replacement: path.resolve(import.meta.dirname, "attached_assets") + "/$1" },
      { find: /^@convex\/(.*)$/, replacement: path.resolve(import.meta.dirname, "convex") + "/$1" },
      { find: /^@shared\/(.*)$/, replacement: path.resolve(import.meta.dirname, "shared") + "/$1" },
      // `@woofx3/api` → index.ts; `@woofx3/api/<sub>` → <sub>.ts
      {
        find: /^@woofx3\/api\/(.+)$/,
        replacement: path.resolve(import.meta.dirname, "../woofx3/shared/clients/typescript/api") + "/$1.ts",
      },
      // `@woofx3/scene/<part>` → <part>/index.ts (model, editor, runtime)
      {
        find: /^@woofx3\/scene\/(.+)$/,
        replacement: path.resolve(import.meta.dirname, "../woofx3/shared/clients/typescript/scene") + "/$1/index.ts",
      },
      {
        find: /^@woofx3\/api$/,
        replacement: path.resolve(import.meta.dirname, "../woofx3/shared/clients/typescript/api/index.ts"),
      },
    ],
  },
  root: path.resolve(import.meta.dirname, "client"),
  envDir: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    // The public user page is its own app (vite.user-page.config.ts); forwarding
    // its path to `bun run dev:user-page` keeps the dashboard from answering it.
    proxy: { "/u/": { target: `http://localhost:${userPageDevPort(process.env)}`, ws: true } },
    allowedHosts: ["ui.dev.woofx3.tv"],
    host: true,
    fs: {
      strict: true,
    },
  },
});
