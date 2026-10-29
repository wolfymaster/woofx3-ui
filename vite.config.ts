import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

/**
 * `--mode desktop` builds the dashboard the woofx3 desktop app shows: desktop
 * features compiled in, written where the Tauri shell bundles it, and pointed
 * at the Convex deployment the shell itself compiles in (WOOFX3_CONVEX_URL),
 * so one variable configures both. Every other mode is the web build, where
 * `__WOOFX3_DESKTOP__` is false and desktop code drops out.
 */
const DESKTOP_MODE = "desktop";

function desktopDefines(): Record<string, string> {
  const convexUrl = process.env.WOOFX3_CONVEX_URL?.trim();
  if (!convexUrl) {
    throw new Error("WOOFX3_CONVEX_URL must be set to build the desktop dashboard");
  }
  const defines: Record<string, string> = {
    __WOOFX3_DESKTOP__: "true",
    "import.meta.env.VITE_CONVEX_URL": JSON.stringify(convexUrl),
  };
  const siteUrl = process.env.WOOFX3_CONVEX_SITE_URL?.trim();
  if (siteUrl) {
    defines["import.meta.env.VITE_CONVEX_SITE_URL"] = JSON.stringify(siteUrl);
  }
  return defines;
}

export default defineConfig(async ({ mode }) => {
  const desktop = mode === DESKTOP_MODE;
  return {
    define: desktop ? desktopDefines() : { __WOOFX3_DESKTOP__: "false" },
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
      outDir: desktop
        ? path.resolve(import.meta.dirname, "companion", "dist")
        : path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
    },
    server: {
      // Must match the companion window's dev port and base (companion/ui/vite.config.ts).
      proxy: desktop ? { "/companion": { target: "http://localhost:1420", ws: true } } : undefined,
      allowedHosts: ["ui.dev.woofx3.tv"],
      host: true,
      fs: {
        strict: true,
      },
    },
  };
});
