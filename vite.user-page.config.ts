import path from "node:path";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";
import { userPageBoundary } from "./client/src/user-page/build/boundary";
import { userPageDevPort } from "./client/src/user-page/build/dev-server";

/**
 * The public user page, `/u/<slug>`: a second app, built apart from the
 * dashboard (vite.config.ts) so nothing signed-in ships with it.
 *
 * Its base is `/u/` because the marketing site owns woofx3.tv and forwards
 * only `/u/*` to this origin. Every file the page loads therefore lives under
 * `/u/` (`/u/assets/...`); a root path such as `/assets/...` would be answered
 * by the marketing site. publicDir is off for the same reason: the dashboard's
 * public files are served from the root. It builds into dist/u, which
 * deploy/Caddyfile serves for `/u/*`, so it runs after the dashboard build,
 * which empties dist.
 */
const repoRoot = import.meta.dirname;
const pageRoot = path.resolve(repoRoot, "client", "src", "user-page");

export default defineConfig({
  base: "/u/",
  root: pageRoot,
  envDir: repoRoot,
  publicDir: false,
  plugins: [react(), userPageBoundary(repoRoot)],
  css: {
    postcss: {
      plugins: [tailwindcss(path.resolve(pageRoot, "tailwind.config.ts")), autoprefixer()],
    },
  },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${path.resolve(repoRoot, "client", "src")}/$1` },
      { find: /^@convex\/(.*)$/, replacement: `${path.resolve(repoRoot, "convex")}/$1` },
      { find: /^@shared\/(.*)$/, replacement: `${path.resolve(repoRoot, "shared")}/$1` },
    ],
  },
  build: {
    outDir: path.resolve(repoRoot, "dist", "u"),
    emptyOutDir: true,
  },
  server: {
    port: userPageDevPort(process.env),
    strictPort: true,
    host: true,
    fs: {
      strict: true,
    },
  },
});
