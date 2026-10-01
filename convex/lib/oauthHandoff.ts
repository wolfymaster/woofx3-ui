/**
 * One-time values that carry an OAuth result from a Convex HTTP callback to
 * the browser that started the flow, without putting provider tokens in a URL.
 *
 * The callback stores the result under a random code and redirects the browser
 * with only that code. The result is released to the signed-in user who
 * started the flow, once, within `HANDOFF_TTL_MS`. Only a SHA-256 hash of the
 * code is stored, so a database read alone cannot redeem it.
 *
 * The sign-in nonce follows the same shape: the SPA keeps it in its own tab
 * and the server keeps only its hash, so a sign-in link completed in another
 * browser cannot sign that browser in.
 *
 * Pure (Web Crypto only), so the rules can be tested without a Convex runtime.
 */

export const HANDOFF_TTL_MS = 5 * 60 * 1000;

const OPAQUE_TOKEN_BYTES = 32;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 256 random bits, base64url without padding (43 characters). */
export function generateOpaqueToken(): string {
  const bytes = new Uint8Array(OPAQUE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Whether a value has the shape `generateOpaqueToken` produces. */
export function isOpaqueToken(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_TOKEN_PATTERN.test(value);
}

/** Lowercase hex SHA-256, the only form of a handoff code or nonce that is stored. */
export async function hashOpaqueToken(token: string): Promise<string> {
  if (!isOpaqueToken(token)) {
    throw new Error("hashOpaqueToken: not an opaque token");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let hex = "";
  const bytes = new Uint8Array(digest);
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export type HandoffProvider = "twitch" | "spotify" | "module";

export type HandoffRefusal = "connect_code_invalid" | "connect_code_expired" | "wrong_user";

/**
 * Why a stored handoff must not be released to this caller, or null when it
 * may. The row is consumed either way; this only decides whether its result
 * is used.
 */
export function handoffRefusal(
  row: { provider: HandoffProvider; userId: string; createdAt: number } | null,
  caller: { provider: HandoffProvider; userId: string },
  now: number
): HandoffRefusal | null {
  if (row === null || row.provider !== caller.provider) {
    return "connect_code_invalid";
  }
  if (now - row.createdAt > HANDOFF_TTL_MS) {
    return "connect_code_expired";
  }
  if (row.userId !== caller.userId) {
    return "wrong_user";
  }
  return null;
}

/**
 * Whether a sign-in may complete: the pending sign-in recorded a nonce hash
 * and the browser finishing it presented the nonce behind that hash.
 */
export function signInNonceMatches(
  storedHash: string | null | undefined,
  presentedHash: string | null | undefined
): boolean {
  if (!storedHash || !presentedHash || storedHash.length !== presentedHash.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < storedHash.length; i += 1) {
    diff |= storedHash.charCodeAt(i) ^ presentedHash.charCodeAt(i);
  }
  return diff === 0;
}
