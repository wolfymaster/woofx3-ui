import { base64UrlEncode } from "./oauthHandoff";

/**
 * Relay credentials: short-lived tokens the companion and the engine present
 * to the edge relay (woofx3-maintenance `worker/`), which checks them without
 * a lookup. Convex is the only minter; the signing key is a Convex env var
 * and never reaches a client.
 *
 * Format: `wfxr1.<kid>.<base64url JSON claims>.<base64url HMAC-SHA256 of "wfxr1.<kid>.<claims>">`.
 * Must produce exactly the format woofx3-maintenance worker/src/relay/credential.ts
 * reads; RELAY_CREDENTIAL_VECTOR in relayCredential.test.ts pins it on both sides.
 */

export type RelayAudience = "companion" | "engine";

export interface RelayClaims {
  v: 1;
  aud: RelayAudience;
  /** Convex instance id; the relay keys its per-instance Durable Object by it. */
  ins: string;
  /** The companion hostname (`c-xxxxxxxxxxxx.woofx3.tv`) the credential is for. */
  host: string;
  /** Companion id, on companion credentials only. */
  cid?: string;
  /** Seconds since the epoch. */
  iat: number;
  /** Seconds since the epoch. */
  exp: number;
}

export interface RelaySigningKey {
  id: string;
  secret: Uint8Array;
}

const PREFIX = "wfxr1";
const MIN_KEY_BYTES = 32;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** How long a companion or engine credential lasts. Revoking a companion cuts it off within one lifetime. */
export const RELAY_CREDENTIAL_LIFETIME_SECONDS = 300;

export function base64UrlDecode(encoded: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(encoded)) {
    return null;
  }
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The claims as JSON with keys in a fixed order (`v, aud, ins, host, cid, iat,
 * exp`), so the same claims always sign to the same credential and the
 * shared test vector stays stable.
 */
function serializeClaims(claims: RelayClaims): string {
  const ordered: Record<string, unknown> = { v: claims.v, aud: claims.aud, ins: claims.ins, host: claims.host };
  if (claims.cid !== undefined) {
    ordered.cid = claims.cid;
  }
  ordered.iat = claims.iat;
  ordered.exp = claims.exp;
  return JSON.stringify(ordered);
}

async function hmacKey(secret: Uint8Array, usage: "sign" | "verify"): Promise<CryptoKey> {
  // A copy, so the key material is a plain ArrayBuffer-backed view whatever the caller passed.
  return crypto.subtle.importKey("raw", new Uint8Array(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signRelayCredential(claims: RelayClaims, key: RelaySigningKey): Promise<string> {
  if ((claims.aud === "companion") !== (claims.cid !== undefined)) {
    throw new Error("A relay credential carries a companion id exactly when it is for the companion");
  }
  if (!KEY_ID_PATTERN.test(key.id)) {
    throw new Error(`Relay signing key id "${key.id}" is not 1-16 base64url characters`);
  }
  const payload = base64UrlEncode(new TextEncoder().encode(serializeClaims(claims)));
  const signingInput = `${PREFIX}.${key.id}.${payload}`;
  const mac = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(key.secret, "sign"),
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(mac))}`;
}

/**
 * The relay's check, for tests only: the relay verifies credentials, Convex
 * never needs to. Checks the signature, the audience and the time window; the
 * relay's own copy also checks claim shapes.
 */
export async function verifyRelayCredential(
  token: string,
  keys: ReadonlyMap<string, Uint8Array>,
  expected: { aud: RelayAudience },
  nowSeconds: number
): Promise<RelayClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    return null;
  }
  const [, kid, payload, signature] = parts;
  const secret = keys.get(kid);
  const mac = base64UrlDecode(signature);
  if (!secret || !mac) {
    return null;
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    new Uint8Array(mac),
    new TextEncoder().encode(`${PREFIX}.${kid}.${payload}`)
  );
  if (!valid) {
    return null;
  }
  const bytes = base64UrlDecode(payload);
  if (!bytes) {
    return null;
  }
  let claims: RelayClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(bytes)) as RelayClaims;
  } catch {
    return null;
  }
  if (claims.v !== 1 || claims.aud !== expected.aud) {
    return null;
  }
  if (claims.exp <= nowSeconds || claims.iat > nowSeconds) {
    return null;
  }
  return claims;
}

/**
 * The signing key from Convex env, or null when the relay is not configured
 * on this deployment. A key that is set but malformed throws: a deployment
 * that meant to offer the relay should fail loudly, not quietly offer none.
 */
export function relaySigningKey(): RelaySigningKey | null {
  const encoded = process.env.RELAY_SIGNING_KEY;
  const id = process.env.RELAY_SIGNING_KEY_ID;
  if (!encoded || !id) {
    return null;
  }
  return parseRelaySigningKey(id, encoded);
}

export function parseRelaySigningKey(id: string, encoded: string): RelaySigningKey {
  if (!KEY_ID_PATTERN.test(id)) {
    throw new Error("RELAY_SIGNING_KEY_ID must be 1-16 base64url characters");
  }
  const secret = base64UrlDecode(encoded.trim());
  if (!secret || secret.length < MIN_KEY_BYTES) {
    throw new Error(`RELAY_SIGNING_KEY must be at least ${MIN_KEY_BYTES} bytes, base64url`);
  }
  return { id, secret };
}

/**
 * Whether this deployment can offer the companion relay: it has the relay's
 * URL and a signing key. Does not parse the key; minting does that.
 */
export function isRelayConfigured(): boolean {
  return Boolean(process.env.RELAY_URL && process.env.RELAY_SIGNING_KEY && process.env.RELAY_SIGNING_KEY_ID);
}
