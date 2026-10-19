import type { MarketplaceAccess } from "./marketplaceAccess";
import { base64UrlEncode } from "./oauthHandoff";

/**
 * Marketplace buyer tokens: short-lived proof that a request acts for one
 * account, so an engine can acquire and download what that account holds
 * without ever holding `MARKETPLACE_API_TOKEN`. Convex is the only minter; the
 * private key is a Convex env var and never leaves this deployment.
 *
 * Format: a compact JWS, every segment unpadded base64url, the signature
 * Ed25519 over the ASCII bytes `header.claims`:
 *
 *   header  {"alg":"EdDSA","typ":"JWT","kid":"<key id>"}
 *   claims  {"aud":"marketplace","sub":"account:<id>","iat":<s>,"exp":<s>,"tier":"dev"?}
 *
 * Must match what woofx3-marketplace-api `internal/httpapi/buyertoken.go`
 * accepts: alg pinned to EdDSA, no `crit`, `exp - iat` at most five minutes,
 * `sub` equal to the `buyerRef` this deployment sends with the write token,
 * and `tier` either absent or `"dev"`. The marketplace finds the public key by
 * `kid` in its `CONTROL_PLANE_PUBLIC_KEYS` (`kid:<base64url raw public key>`).
 *
 * Signing uses WebCrypto Ed25519, which both the default Convex runtime and
 * Node implement, so a token can be minted from either kind of action file.
 */

export const BUYER_TOKEN_AUDIENCE = "marketplace";
/** The marketplace refuses anything longer; one token covers one install. */
export const BUYER_TOKEN_LIFETIME_SECONDS = 300;

export const BUYER_SIGNING_KEY_ENV = "MARKETPLACE_BUYER_SIGNING_KEY";
export const BUYER_SIGNING_KEY_ID_ENV = "MARKETPLACE_BUYER_SIGNING_KEY_ID";

/**
 * The marketplace reads `CONTROL_PLANE_PUBLIC_KEYS` as comma-separated
 * `kid:key` pairs, splitting at the first colon, so a key id may hold neither.
 * Kept to a plain token alphabet so it also needs no quoting anywhere.
 */
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const BUYER_REF_PATTERN = /^account:.+$/;

export interface BuyerTokenHeader {
  alg: "EdDSA";
  typ: "JWT";
  kid: string;
}

export interface BuyerTokenClaims {
  aud: typeof BUYER_TOKEN_AUDIENCE;
  /** `account:{accountId}`, the same value as `buyerRefFor`. */
  sub: string;
  /** Seconds since the epoch. */
  iat: number;
  /** Seconds since the epoch. */
  exp: number;
  /** Present only for accounts with dev marketplace access; the marketplace then shows dev-tier listings. */
  tier?: "dev";
}

export interface BuyerSigningKey {
  kid: string;
  privateKey: CryptoKey;
}

/**
 * The claims for `buyerRef` at `access`, issued at `nowMs`.
 *
 * Keys are written in a fixed order (`aud, sub, iat, exp, tier`) so the same
 * inputs always sign the same bytes.
 */
export function buyerTokenClaims(buyerRef: string, access: MarketplaceAccess, nowMs: number): BuyerTokenClaims {
  if (!BUYER_REF_PATTERN.test(buyerRef)) {
    throw new Error(`Buyer ref "${buyerRef}" is not account:{id}`);
  }
  if (!Number.isFinite(nowMs)) {
    throw new Error("Buyer token issue time must be a finite number");
  }
  const iat = Math.floor(nowMs / 1000);
  const claims: BuyerTokenClaims = {
    aud: BUYER_TOKEN_AUDIENCE,
    sub: buyerRef,
    iat,
    exp: iat + BUYER_TOKEN_LIFETIME_SECONDS,
  };
  if (access === "dev") {
    claims.tier = "dev";
  }
  return claims;
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

export async function signBuyerToken(claims: BuyerTokenClaims, key: BuyerSigningKey): Promise<string> {
  if (!KEY_ID_PATTERN.test(key.kid)) {
    throw new Error(`Buyer signing key id "${key.kid}" must be 1-64 characters of A-Z a-z 0-9 . _ -`);
  }
  const header: BuyerTokenHeader = { alg: "EdDSA", typ: "JWT", kid: key.kid };
  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign("Ed25519", key.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Imports the private key from its env form: the Ed25519 private key as a
 * JWK (`{"kty":"OKP","crv":"Ed25519","d":"…","x":"…"}`).
 *
 * JWK rather than PKCS#8 because it carries the public half too, and the
 * Convex runtime refuses a JWK whose `d` and `x` disagree, so a pasted key
 * that does not match the public key the marketplace was given fails at
 * import instead of minting tokens the marketplace rejects. Only the four key
 * fields are passed on: `ext`, `key_ops` or `alg` left over from an export
 * would otherwise have to agree with this import's own options.
 */
export async function importBuyerSigningKey(kid: string, jwkJson: string): Promise<BuyerSigningKey> {
  if (!KEY_ID_PATTERN.test(kid)) {
    throw new Error(`${BUYER_SIGNING_KEY_ID_ENV} must be 1-64 characters of A-Z a-z 0-9 . _ -`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jwkJson);
  } catch {
    throw new Error(`${BUYER_SIGNING_KEY_ENV} must be an Ed25519 private key as JWK JSON`);
  }
  const jwk = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.d !== "string" || typeof jwk.x !== "string") {
    throw new Error(`${BUYER_SIGNING_KEY_ENV} must be an Ed25519 private JWK with kty OKP, crv Ed25519, d and x`);
  }
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x },
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  return { kid, privateKey };
}

/**
 * The signing key from `MARKETPLACE_BUYER_SIGNING_KEY` and
 * `MARKETPLACE_BUYER_SIGNING_KEY_ID`. Read when a token is minted, not at
 * load, so a deployment without them runs normally until something needs a
 * token, and then fails with a message naming what to set.
 */
export async function buyerSigningKeyFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<BuyerSigningKey> {
  const jwkJson = env[BUYER_SIGNING_KEY_ENV]?.trim();
  const kid = env[BUYER_SIGNING_KEY_ID_ENV]?.trim();
  if (!jwkJson || !kid) {
    throw new Error(
      `Marketplace buyer tokens are not configured: set ${BUYER_SIGNING_KEY_ENV} and ${BUYER_SIGNING_KEY_ID_ENV}`
    );
  }
  return await importBuyerSigningKey(kid, jwkJson);
}

/** A buyer token for `buyerRef` at `access`, valid for five minutes from `nowMs`. */
export async function mintBuyerToken(
  buyerRef: string,
  access: MarketplaceAccess,
  key: BuyerSigningKey,
  nowMs: number = Date.now()
): Promise<string> {
  return await signBuyerToken(buyerTokenClaims(buyerRef, access, nowMs), key);
}

/**
 * A fresh signing key pair in the forms it is configured in: the Convex env
 * values, and the entry for the marketplace's `CONTROL_PLANE_PUBLIC_KEYS`.
 * The JWK `x` is already the raw 32-byte public key in unpadded base64url,
 * which is the encoding the marketplace expects.
 */
export async function generateBuyerSigningKey(kid: string): Promise<{
  signingKeyJwk: string;
  controlPlanePublicKey: string;
}> {
  if (!KEY_ID_PATTERN.test(kid)) {
    throw new Error(`Key id "${kid}" must be 1-64 characters of A-Z a-z 0-9 . _ -`);
  }
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (typeof jwk.d !== "string" || typeof jwk.x !== "string") {
    throw new Error("Ed25519 key export did not include d and x");
  }
  return {
    signingKeyJwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x }),
    controlPlanePublicKey: `${kid}:${jwk.x}`,
  };
}
