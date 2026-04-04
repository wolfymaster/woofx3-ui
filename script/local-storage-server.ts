/**
 * Local storage server for the "local" asset storage adapter.
 *
 * Provides upload, serve, and delete endpoints so the browser can store
 * asset files on the local filesystem during development or in self-hosted
 * deployments.
 *
 * Usage:
 *   bun script/local-storage-server.ts
 *
 * Env vars (optional — defaults shown):
 *   LOCAL_STORAGE_PORT=4001
 *   LOCAL_STORAGE_DIR=./uploads
 *
 * Configure Convex to point at this server:
 *   npx convex env set LOCAL_STORAGE_URL http://localhost:4001
 *   npx convex env set LOCAL_STORAGE_DIR /absolute/path/to/uploads
 *   npx convex env set STORAGE_PROVIDER local
 */

import { mkdir, unlink } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const PORT = parseInt(process.env.LOCAL_STORAGE_PORT ?? "4001", 10);
const STORAGE_DIR = resolve(process.env.LOCAL_STORAGE_DIR ?? "./uploads");

// Ensure storage directory exists on startup
await mkdir(STORAGE_DIR, { recursive: true });
console.log(`[local-storage] Serving files from: ${STORAGE_DIR}`);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-File-Key",
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // POST /storage/upload — receive a file and save to disk
    if (req.method === "POST" && url.pathname === "/storage/upload") {
      const fileKey = req.headers.get("X-File-Key");
      if (!fileKey) {
        return new Response("Missing X-File-Key header", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      // Prevent path traversal
      const safePath = join(STORAGE_DIR, fileKey);
      if (!safePath.startsWith(STORAGE_DIR)) {
        return new Response("Invalid file key", { status: 400, headers: CORS_HEADERS });
      }

      await mkdir(dirname(safePath), { recursive: true });

      const buffer = await req.arrayBuffer();
      await Bun.write(safePath, buffer);

      console.log(`[local-storage] Saved: ${fileKey} (${buffer.byteLength} bytes)`);
      return new Response(JSON.stringify({ success: true, fileKey }), {
        status: 201,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // GET /storage/files/* — serve a file
    if (req.method === "GET" && url.pathname.startsWith("/storage/files/")) {
      const fileKey = decodeURIComponent(url.pathname.replace("/storage/files/", ""));
      const safePath = join(STORAGE_DIR, fileKey);

      if (!safePath.startsWith(STORAGE_DIR) || !existsSync(safePath)) {
        return new Response("Not found", { status: 404, headers: CORS_HEADERS });
      }

      const file = Bun.file(safePath);
      return new Response(file, {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "Cache-Control": "public, max-age=31536000",
          ...CORS_HEADERS,
        },
      });
    }

    // DELETE /storage/files/* — delete a file
    if (req.method === "DELETE" && url.pathname.startsWith("/storage/files/")) {
      const fileKey = decodeURIComponent(url.pathname.replace("/storage/files/", ""));
      const safePath = join(STORAGE_DIR, fileKey);

      if (!safePath.startsWith(STORAGE_DIR)) {
        return new Response("Invalid file key", { status: 400, headers: CORS_HEADERS });
      }

      if (existsSync(safePath)) {
        await unlink(safePath);
        console.log(`[local-storage] Deleted: ${fileKey}`);
      }

      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
});

console.log(`[local-storage] Listening on http://localhost:${PORT}`);
