/**
 * Encryption at rest for viewers' platform tokens. A viewer grants woofx3 read
 * access to their follows and subscriptions; a database export alone must not
 * hand those grants out, so access and refresh tokens are stored sealed with
 * AES-256-GCM under `VIEWER_TOKEN_ENCRYPTION_KEY`, which only Convex holds.
 *
 * Sealed form: `v1.<base64url(12-byte IV)>.<base64url(ciphertext + tag)>`. The
 * version prefix lets a later key rotation tell old values from new ones.
 *
 * Web Crypto only, so it runs in the default Convex runtime and in tests.
 */
import { base64UrlEncode } from "./oauthHandoff";

export const VIEWER_TOKEN_KEY_ENV = "VIEWER_TOKEN_ENCRYPTION_KEY";

const SEALED_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Imports a 32-byte key given as base64url (or base64). Throws on any other shape. */
export async function importViewerTokenKey(encoded: string | undefined): Promise<CryptoKey> {
  if (!encoded) {
    throw new Error(`${VIEWER_TOKEN_KEY_ENV} is not set`);
  }
  const raw = decodeBase64Url(encoded.trim());
  if (raw === null || raw.length !== KEY_BYTES) {
    throw new Error(`${VIEWER_TOKEN_KEY_ENV} must be ${KEY_BYTES} bytes, base64url encoded`);
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function viewerTokenKeyFromEnv(): Promise<CryptoKey> {
  return importViewerTokenKey(process.env[VIEWER_TOKEN_KEY_ENV]);
}

export async function sealViewerToken(key: CryptoKey, plaintext: string): Promise<string> {
  if (plaintext.length === 0) {
    throw new Error("sealViewerToken: refusing to seal an empty token");
  }
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${SEALED_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

/** The token a sealed value holds. Throws when it is malformed or was sealed under another key. */
export async function openViewerToken(key: CryptoKey, sealed: string): Promise<string> {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== SEALED_VERSION) {
    throw new Error("openViewerToken: not a sealed viewer token");
  }
  const iv = decodeBase64Url(parts[1]);
  const ciphertext = decodeBase64Url(parts[2]);
  if (iv === null || iv.length !== IV_BYTES || ciphertext === null) {
    throw new Error("openViewerToken: not a sealed viewer token");
  }
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

function decodeBase64Url(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_+/-]*={0,2}$/.test(encoded)) {
    return null;
  }
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
