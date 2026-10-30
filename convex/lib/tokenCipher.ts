/**
 * Encryption at rest for platform OAuth tokens: a viewer's grant to read their
 * follows and subscriptions, and a streamer's grant to act on their channel. A
 * database export alone must not hand those grants out, so access and refresh
 * tokens are stored sealed with AES-256-GCM under a key only Convex holds.
 *
 * Each kind of token has its own key, so one can be rotated, or turn out to be
 * leaked, without touching the other.
 *
 * Sealed form: `<keyId>.<base64url(12-byte IV)>.<base64url(ciphertext + tag)>`.
 * The key id names the key that sealed the value, so a later rotation can open
 * values sealed under the old key while sealing new ones under the next.
 *
 * Web Crypto only, so it runs in the default Convex runtime and in tests.
 */
import { base64UrlEncode } from "./oauthHandoff";

/** Which key seals one kind of token, and under which id its values are stored. */
export interface TokenKeySpec {
  /** What the sealed values are, for error messages. */
  label: string;
  envVar: string;
  /** Lowercase letters and digits. Must never be reused for a different key. */
  keyId: string;
}

/**
 * Viewer tokens (`viewerPlatformTokens`). The key id is the `v1` prefix every
 * viewer value has carried since viewer sign-in shipped; it cannot change
 * without resealing those rows.
 */
export const VIEWER_TOKEN_KEY: TokenKeySpec = {
  label: "viewer token",
  envVar: "VIEWER_TOKEN_ENCRYPTION_KEY",
  keyId: "v1",
};

/** Streamer tokens (`platformLinks`). */
export const PLATFORM_TOKEN_KEY: TokenKeySpec = {
  label: "platform token",
  envVar: "PLATFORM_TOKEN_ENCRYPTION_KEY",
  keyId: "p1",
};

export interface TokenCipher {
  readonly spec: TokenKeySpec;
  /** Seals a non-empty token under this cipher's key, with a fresh IV each time. */
  seal(plaintext: string): Promise<string>;
  /** The token a sealed value holds. Throws when it is malformed, tampered with, or sealed under another key. */
  open(sealed: string): Promise<string>;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_ID_PATTERN = /^[a-z0-9]+$/;

/** Imports a 32-byte key given as base64url (or base64). Throws on any other shape. */
export async function importTokenCipher(spec: TokenKeySpec, encoded: string | undefined): Promise<TokenCipher> {
  if (!KEY_ID_PATTERN.test(spec.keyId)) {
    throw new Error(`${spec.label} key id "${spec.keyId}" must be lowercase letters and digits`);
  }
  if (!encoded) {
    throw new Error(`${spec.envVar} is not set`);
  }
  const raw = decodeBase64Url(encoded.trim());
  if (raw === null || raw.length !== KEY_BYTES) {
    throw new Error(`${spec.envVar} must be ${KEY_BYTES} bytes, base64url encoded`);
  }
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return {
    spec,
    seal: (plaintext) => seal(spec, key, plaintext),
    open: (sealed) => open(spec, key, sealed),
  };
}

export function tokenCipherFromEnv(spec: TokenKeySpec): Promise<TokenCipher> {
  return importTokenCipher(spec, process.env[spec.envVar]);
}

async function seal(spec: TokenKeySpec, key: CryptoKey, plaintext: string): Promise<string> {
  if (plaintext.length === 0) {
    throw new Error(`refusing to seal an empty ${spec.label}`);
  }
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${spec.keyId}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

async function open(spec: TokenKeySpec, key: CryptoKey, sealed: string): Promise<string> {
  const parts = sealed.split(".");
  if (parts.length !== 3) {
    throw new Error(`not a sealed ${spec.label}`);
  }
  if (parts[0] !== spec.keyId) {
    throw new Error(`${spec.label} was sealed under key "${parts[0]}", not "${spec.keyId}"`);
  }
  const iv = decodeBase64Url(parts[1]);
  const ciphertext = decodeBase64Url(parts[2]);
  if (iv === null || iv.length !== IV_BYTES || ciphertext === null) {
    throw new Error(`not a sealed ${spec.label}`);
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
