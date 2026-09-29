/**
 * Redirect targets that arrive in a URL (`redirect_to`) and are later
 * navigated to. Only a path on this site is allowed: anything that could name
 * another origin (`https://…`, `//host`, `/\host`, `javascript:`) would turn
 * the OAuth round trip into an open redirect.
 *
 * Shared by Convex (which stores the target in OAuth state) and the client
 * (which navigates to it), so it stays free of Convex imports.
 */

const PROBE_ORIGIN = "https://same-origin.invalid";

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Parsing collapses dot segments, so a value that passed the prefix checks
 * can still come out as `//host` ("/..//evil.com", "/%2e%2e//evil.com").
 * Each pass re-checks its own output until the path stops changing.
 */
const MAX_NORMALIZE_PASSES = 4;

/**
 * Whether the value, percent-decoded once, would name another origin or carry
 * a control character. Nothing here decodes a target before navigating, but a
 * consumer that did would turn "/%2F%2Fevil.com" into "//evil.com"; refusing
 * those up front keeps every consumer safe. Undecodable input is refused too.
 */
function unsafeOnceDecoded(value: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return true;
  }
  return decoded.startsWith("//") || decoded.startsWith("/\\") || hasControlCharacter(decoded);
}

function normalizeOnce(value: string): string | null {
  // Browsers treat a backslash as a slash and drop tabs and newlines inside
  // URLs, so "/\evil.com" and "/\t/evil.com" both escape the origin.
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacter(value) ||
    unsafeOnceDecoded(value)
  ) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PROBE_ORIGIN) {
    return null;
  }
  const result = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (result.startsWith("//") || result.startsWith("/\\")) {
    return null;
  }
  return result;
}

export function safeRelativePath(value: string | null | undefined, fallback = "/"): string {
  if (!fallback.startsWith("/") || fallback.startsWith("//")) {
    throw new Error(`fallback must be a site-relative path, got ${fallback}`);
  }
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  let current = value;
  for (let pass = 0; pass < MAX_NORMALIZE_PASSES; pass += 1) {
    const next = normalizeOnce(current);
    if (next === null) {
      return fallback;
    }
    if (next === current) {
      return next;
    }
    current = next;
  }
  return fallback;
}

/**
 * A same-site path (clamped as `safeRelativePath` does) with result parameters
 * added to whatever query it already has, so a target like `/settings?tab=x`
 * keeps its own parameters instead of gaining a second `?`.
 */
export function withQuery(path: string | null | undefined, params: Record<string, string>, fallback = "/"): string {
  const safe = safeRelativePath(path, fallback);
  const url = new URL(safe, PROBE_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
