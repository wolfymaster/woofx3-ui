import type { UploadIntent } from "./types";

/** Build a file key for local storage (namespaced by instance). */
export function buildLocalFileKey(instanceId: string, fileName: string): string {
  const uuid = crypto.randomUUID();
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${instanceId}/${uuid}/${sanitized}`;
}

/**
 * Generate an upload intent for local filesystem storage.
 * The browser POSTs directly to the local storage server (script/local-storage-server.ts).
 *
 * Env vars required: LOCAL_STORAGE_URL (e.g., "http://localhost:4001")
 */
export function generateLocalUploadIntent(instanceId: string, fileName: string): UploadIntent {
  const localUrl = process.env.LOCAL_STORAGE_URL;
  if (!localUrl) {
    throw new Error("LOCAL_STORAGE_URL env var is not set. Start script/local-storage-server.ts and configure this env var.");
  }

  const fileKey = buildLocalFileKey(instanceId, fileName);

  return {
    uploadUrl: `${localUrl.replace(/\/$/, "")}/storage/upload`,
    method: "POST",
    headers: { "X-File-Key": fileKey },
    fileKey,
    provider: "local",
    requiresResponseKey: false,
  };
}

/**
 * Resolve a local file key to a URL served by the local storage server.
 * Requires LOCAL_STORAGE_URL env var.
 */
export function resolveLocalUrl(fileKey: string): string | null {
  const localUrl = process.env.LOCAL_STORAGE_URL;
  if (!localUrl) return null;
  return `${localUrl.replace(/\/$/, "")}/storage/files/${fileKey}`;
}
