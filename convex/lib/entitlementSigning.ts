import { createPrivateKey, createPublicKey, type KeyObject, sign } from "node:crypto";

// node:crypto: import only from "use node" files.

/** PKCS#8 DER prefix for an Ed25519 private key; the 32-byte seed follows it. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

export interface EntitlementSigningKey {
  id: string;
  privateKey: KeyObject;
}

/**
 * The grant signing key from Convex env, or null when this deployment does
 * not sign grants (a dev deployment with no managed engines). A key that is
 * set but malformed throws, so a deployment meant to sign does not quietly
 * leave every managed engine without its features.
 *
 * `ENTITLEMENT_SIGNING_KEY` is the 32-byte Ed25519 seed in base64url;
 * `ENTITLEMENT_SIGNING_KEY_ID` names it in each grant's header.
 */
export function entitlementSigningKey(): EntitlementSigningKey | null {
  const seed = process.env.ENTITLEMENT_SIGNING_KEY;
  const id = process.env.ENTITLEMENT_SIGNING_KEY_ID;
  if (!seed && !id) {
    return null;
  }
  if (!seed || !id) {
    throw new Error("ENTITLEMENT_SIGNING_KEY and ENTITLEMENT_SIGNING_KEY_ID must be set together");
  }
  return parseEntitlementSigningKey(id, seed);
}

export function parseEntitlementSigningKey(id: string, seed: string): EntitlementSigningKey {
  if (!KEY_ID_PATTERN.test(id)) {
    throw new Error("ENTITLEMENT_SIGNING_KEY_ID must be 1-16 base64url characters");
  }
  const raw = Buffer.from(seed.trim(), "base64url");
  if (raw.length !== 32) {
    throw new Error("ENTITLEMENT_SIGNING_KEY must be a 32-byte Ed25519 seed, base64url");
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });
  return { id, privateKey };
}

/** The compact JWS for a signing input built by `grantSigningInput`. */
export function signGrant(key: EntitlementSigningKey, signingInput: string): string {
  const signature = sign(null, Buffer.from(signingInput), key.privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * The `kid:key` entry an engine needs in `WOOFX3_ENTITLEMENT_PUBLIC_KEYS` to
 * verify grants signed with this key.
 */
export function publicKeyEntry(key: EntitlementSigningKey): string {
  const jwk = createPublicKey(key.privateKey).export({ format: "jwk" });
  if (typeof jwk.x !== "string") {
    throw new Error("Could not derive the public key");
  }
  return `${key.id}:${jwk.x}`;
}
