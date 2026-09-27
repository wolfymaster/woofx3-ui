import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Reading and writing module zip archives for the install flow.
 *
 * The engine identifies an install by `{id}:{version}:{hash}`, where hash is the
 * first 7 hex characters of the SHA-256 of the uploaded archive bytes (barkloader's
 * upload handler in the woofx3 repo, `app/src/routes/functions.rs`). It rejects an
 * install whose key does not match, so the key must be computed over exactly the
 * bytes that are uploaded, never over a re-encoding of them.
 *
 * The synchronous fflate calls are deliberate: module archives are small, and the
 * async variants spawn a Web Worker from a blob URL, which buys little here.
 */

const MODULE_KEY_HASH_LENGTH = 7;

/**
 * Every file entry of a zip, decoded as UTF-8 text and keyed by its path inside
 * the archive. Directory entries (paths ending in "/") are dropped.
 */
export function readModuleArchive(bytes: Uint8Array): Record<string, string> {
  const entries = unzipSync(bytes);
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(entries)) {
    if (path.endsWith("/")) {
      continue;
    }
    files[path] = strFromU8(content);
  }
  return files;
}

/**
 * The single top-level directory every path shares (with its trailing slash), or
 * "" when paths sit at the root or under different directories. Archives zipped
 * from a folder carry that folder as a wrapper; the engine expects the manifest
 * at the root.
 */
export function getCommonDirectoryPrefix(paths: string[]): string {
  if (paths.length === 0) {
    return "";
  }
  const firstSlash = paths[0].indexOf("/");
  if (firstSlash === -1) {
    return "";
  }
  const candidate = paths[0].slice(0, firstSlash + 1);
  if (paths.every((p) => p.startsWith(candidate))) {
    return candidate;
  }
  return "";
}

/** Zips the files at the archive root, stripping any common wrapper directory. */
export function buildModuleArchive(files: Record<string, string>): Uint8Array {
  const prefix = getCommonDirectoryPrefix(Object.keys(files));
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    const rootPath = path.slice(prefix.length);
    if (rootPath.length === 0) {
      throw new Error(`Archive entry "${path}" has no name below its directory`);
    }
    entries[rootPath] = strToU8(content);
  }
  return zipSync(entries, { level: 6 });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The `{id}:{version}:{hash}` key the engine computes for these archive bytes. */
export async function computeModuleKey(moduleId: string, version: string, archive: Uint8Array): Promise<string> {
  const hash = await sha256Hex(archive);
  return `${moduleId}:${version}:${hash.slice(0, MODULE_KEY_HASH_LENGTH)}`;
}
