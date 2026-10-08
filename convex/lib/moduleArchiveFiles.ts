import type { ModuleFileContent, ModuleFileEntry, ModuleFileList } from "@woofx3/api/api";
import { MODULE_FILE_TEXT_LIMIT_BYTES } from "@woofx3/api/api";
import { type UnzipFileInfo, unzipSync } from "fflate";

/**
 * A module archive's files as the engine's read-only file viewer presents
 * them (`listModuleFiles` / `getModuleFile`), for a module that is not
 * installed and so has only its marketplace zip. Every rule here must match
 * the engine's, so a module shows the same files before and after install:
 * woofx3 `barkloader/app/src/routes/archives.rs` (root, paths, junk) and
 * `classifyModuleFile` in `api/src/routes/modules.ts` (text, binary, too large).
 */

/**
 * Manifest names the installer accepts, best first. Matches barkloader's
 * `manifest_file_rank`: the file's last segment, compared case-insensitively.
 */
const MANIFEST_NAMES = ["manifest.json", "manifest.yaml", "manifest.yml", "module.json", "module.yaml", "module.yml"];

/** Entries archiving tools add beside the module's own files. */
const JUNK_SEGMENTS = new Set(["__MACOSX", ".DS_Store"]);

/**
 * Entries larger than this are reported `too_large` without being inflated.
 * The engine inflates only the first `MODULE_FILE_TEXT_LIMIT_BYTES + 1` bytes
 * of any entry, which fflate's synchronous unzip cannot do, so an entry whose
 * header claims more than this is not inflated at all: a hostile header could
 * otherwise make the action buffer gigabytes. The cost is that such an entry
 * reads `too_large` where the engine might say `binary`; neither has content.
 */
const MAX_INFLATE_BYTES = 16 * 1024 * 1024;

function manifestRank(name: string): number | null {
  const lower = name.replace(/\\/g, "/").toLowerCase();
  const rank = MANIFEST_NAMES.findIndex((suffix) => lower === suffix || lower.endsWith(`/${suffix}`));
  return rank === -1 ? null : rank;
}

/**
 * A zip member name as a relative path, or null when it has a `..` segment.
 * Mirrors barkloader's `normalize_rel_path`.
 */
export function normalizeArchivePath(name: string): string | null {
  let normalized = name;
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.split("/").some((segment) => segment === "..")) {
    return null;
  }
  return normalized;
}

function isJunk(path: string): boolean {
  return path.split("/").some((segment) => JUNK_SEGMENTS.has(segment));
}

/**
 * The directory holding the manifest the installer would pick, with its
 * trailing slash: best-ranked name first, then the shallowest. Empty when the
 * manifest sits at the zip root or there is none.
 */
export function moduleArchiveRoot(names: readonly string[]): string {
  let best: { rank: number; depth: number; root: string } | null = null;
  for (const name of names) {
    const rank = manifestRank(name);
    if (rank === null) {
      continue;
    }
    const normalized = normalizeArchivePath(name);
    if (normalized === null || isJunk(normalized)) {
      continue;
    }
    const depth = normalized.split("/").length - 1;
    if (best === null || rank < best.rank || (rank === best.rank && depth < best.depth)) {
      const slash = normalized.lastIndexOf("/");
      best = { rank, depth, root: slash === -1 ? "" : normalized.slice(0, slash + 1) };
    }
  }
  return best?.root ?? "";
}

/** A member name relative to the module root, or null when it is not one of the module's files. */
function modulePath(root: string, name: string): string | null {
  if (name.endsWith("/")) {
    return null;
  }
  const normalized = normalizeArchivePath(name);
  if (normalized === null || !normalized.startsWith(root)) {
    return null;
  }
  const rel = normalized.slice(root.length);
  if (rel === "" || isJunk(rel)) {
    return null;
  }
  return rel;
}

/** Every member's header, without inflating any of them. */
function readHeaders(archive: Uint8Array): UnzipFileInfo[] {
  const headers: UnzipFileInfo[] = [];
  unzipSync(archive, {
    filter: (file) => {
      headers.push(file);
      return false;
    },
  });
  return headers;
}

/** The module's files, sorted by path, as `listModuleFiles` returns them. */
export function listArchiveModuleFiles(archive: Uint8Array): ModuleFileList {
  const headers = readHeaders(archive);
  const root = moduleArchiveRoot(headers.map((h) => h.name));
  const files: ModuleFileEntry[] = [];
  for (const header of headers) {
    const path = modulePath(root, header.name);
    if (path !== null) {
      files.push({ path, size: header.originalSize });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { available: true, files };
}

/**
 * One file under the module root, classified like `getModuleFile`. Throws
 * `file not found in module: <path>` for a path `listArchiveModuleFiles` would
 * not list, with the engine's wording.
 */
export function readArchiveModuleFile(archive: Uint8Array, path: string): ModuleFileContent {
  const rel = normalizeArchivePath(path);
  if (rel === null || rel === "") {
    throw new Error(`file not found in module: ${path}`);
  }
  const headers = readHeaders(archive);
  const root = moduleArchiveRoot(headers.map((h) => h.name));
  const header = headers.find((h) => modulePath(root, h.name) === rel);
  if (!header) {
    throw new Error(`file not found in module: ${rel}`);
  }
  if (header.originalSize > MAX_INFLATE_BYTES) {
    return { path: rel, size: header.originalSize, kind: "too_large" };
  }
  const entries = unzipSync(archive, { filter: (file) => file.name === header.name });
  const bytes = entries[header.name];
  if (!bytes) {
    throw new Error(`file not found in module: ${rel}`);
  }
  return classifyModuleFile(rel, bytes.subarray(0, MODULE_FILE_TEXT_LIMIT_BYTES + 1), bytes.byteLength);
}

/**
 * Text when the bytes are valid UTF-8 with no NUL, `too_large` when they are
 * text but over the limit, `binary` otherwise. `bytes` holds at most
 * `MODULE_FILE_TEXT_LIMIT_BYTES + 1` bytes of the file and `declaredSize` its
 * full size; a cut-off file is judged on the bytes present, ignoring a
 * multi-byte character the cut split.
 */
export function classifyModuleFile(path: string, bytes: Uint8Array, declaredSize: number): ModuleFileContent {
  const size = Math.max(declaredSize, bytes.byteLength);
  const truncated = size > MODULE_FILE_TEXT_LIMIT_BYTES;
  if (bytes.includes(0)) {
    return { path, size, kind: "binary" };
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated });
  } catch {
    return { path, size, kind: "binary" };
  }
  if (truncated) {
    return { path, size, kind: "too_large" };
  }
  return { path, size, kind: "text", content };
}
