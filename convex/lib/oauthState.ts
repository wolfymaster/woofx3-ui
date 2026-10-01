/**
 * The OAuth `state` parameter, which also says which deployment a callback
 * belongs to.
 *
 * A preview deployment's callbacks arrive at production (`oauthCallback.ts`),
 * and only the preview that started the flow holds its state row. So the state
 * carries that deployment's site URL, and production forwards the callback
 * there. Forwarding hands the provider's authorization code to that URL, so
 * production forwards only a state signed with `OAUTH_STATE_SECRET`, which
 * production and the previews share; otherwise any `*.convex.site` deployment
 * could have production deliver codes to it.
 *
 * Format: `<random>.<base64url(origin)>.<base64url(HMAC-SHA256)>`, the HMAC
 * covering everything before its dot. A state for a deployment's own callbacks
 * is still validated by its state row, so its signature is not checked.
 *
 * Pure (Web Crypto only), so the rules can be tested without a Convex runtime.
 */
import { base64UrlEncode, generateOpaqueToken, isOpaqueToken } from "./oauthHandoff";

export interface OAuthStateConfig {
  /** This deployment's own site URL (`CONVEX_SITE_URL`). */
  siteUrl: string;
  /** Where providers send this deployment's callbacks; differs from `siteUrl` when another deployment forwards them. */
  callbackBaseUrl: string;
  /** Shared by every deployment that forwards callbacks or has them forwarded. */
  secret: string | undefined;
}

export type OAuthStateRoute = { kind: "here" } | { kind: "forward"; origin: string } | { kind: "invalid" };

export function oauthStateConfigFromEnv(): OAuthStateConfig {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) {
    throw new Error("CONVEX_SITE_URL is not set");
  }
  return {
    siteUrl,
    callbackBaseUrl: process.env.OAUTH_CALLBACK_BASE_URL || siteUrl,
    secret: process.env.OAUTH_STATE_SECRET || undefined,
  };
}

/** A fresh state naming this deployment, signed when a secret is configured. */
export async function mintOAuthState(config: OAuthStateConfig): Promise<string> {
  const origin = new URL(config.siteUrl).origin;
  const forwarded = new URL(config.callbackBaseUrl).origin !== origin;
  if (forwarded && !config.secret) {
    throw new Error("OAUTH_STATE_SECRET must be set when OAUTH_CALLBACK_BASE_URL points at another deployment");
  }
  const unsigned = `${generateOpaqueToken()}.${base64UrlEncode(new TextEncoder().encode(origin))}`;
  if (!config.secret) {
    return unsigned;
  }
  return `${unsigned}.${base64UrlEncode(await hmac(config.secret, unsigned))}`;
}

/** Whether a callback carrying `state` is handled here, forwarded to the deployment that minted it, or refused. */
export async function routeOAuthState(state: string, config: OAuthStateConfig): Promise<OAuthStateRoute> {
  const parts = state.split(".");
  // A state without an origin was minted for this deployment's own callbacks.
  if (parts.length === 1) {
    return { kind: "here" };
  }
  if (parts.length > 3 || !isOpaqueToken(parts[0])) {
    return { kind: "invalid" };
  }
  const origin = decodeOrigin(parts[1]);
  if (origin === null) {
    return { kind: "invalid" };
  }
  if (origin === new URL(config.siteUrl).origin) {
    return { kind: "here" };
  }
  const signature = parts[2] === undefined ? null : base64UrlDecode(parts[2]);
  if (!config.secret || signature === null || !origin.startsWith("https://")) {
    return { kind: "invalid" };
  }
  const key = await hmacKey(config.secret);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify("HMAC", key, signature, signed))) {
    return { kind: "invalid" };
  }
  return { kind: "forward", origin };
}

/** The same callback, path and query unchanged, at the deployment that minted its state. */
export function forwardedCallbackUrl(origin: string, callback: URL): string {
  return new URL(`${callback.pathname}${callback.search}`, origin).toString();
}

function decodeOrigin(encoded: string): string | null {
  const bytes = base64UrlDecode(encoded);
  if (bytes === null) {
    return null;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    // Only a bare origin: anything with a path, query or credentials is not one this module minted.
    return new URL(text).origin === text ? text : null;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

function base64UrlDecode(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) {
    return null;
  }
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
