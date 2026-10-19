import { describe, expect, it } from "bun:test";
import {
  BUYER_TOKEN_LIFETIME_SECONDS,
  buyerSigningKeyFromEnv,
  buyerTokenClaims,
  generateBuyerSigningKey,
  importBuyerSigningKey,
  mintBuyerToken,
} from "./marketplaceBuyerToken";
import { base64UrlDecode } from "./relayCredential";

/**
 * A fixed key pair. Ed25519 signatures are deterministic, so with a fixed
 * issue time the tokens below are fixed too. The same two tokens verify
 * against woofx3-marketplace-api's `verifyBuyerToken` with this public key
 * registered as `cp-test-1`, which pins the format on both sides.
 *
 * These vectors MUST stay in sync with `TestBuyerTokenCrossRepoVectors` in
 * woofx3-marketplace-api's internal/httpapi/buyertoken_test.go. If the token
 * format changes, update both tests together.
 */
const TEST_KID = "cp-test-1";
const TEST_PUBLIC_KEY = "J_Y9g67WJLfKYAGtu2uf1PLeYJTtyqumyKimTNHJHOE";
const TEST_JWK = JSON.stringify({
  kty: "OKP",
  crv: "Ed25519",
  d: "sH1Jav_akH-FsPFY-MLUswibgLrwrpbXzD8TdTVwodY",
  x: TEST_PUBLIC_KEY,
});
const BUYER = "account:j57abc";
const NOW_MS = 1_760_000_000_000;

const PUBLIC_VECTOR =
  "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6ImNwLXRlc3QtMSJ9." +
  "eyJhdWQiOiJtYXJrZXRwbGFjZSIsInN1YiI6ImFjY291bnQ6ajU3YWJjIiwiaWF0IjoxNzYwMDAwMDAwLCJleHAiOjE3NjAwMDAzMDB9." +
  "T5IggSqxoCa5ZSGSBIenVPey6TyVd8TdeWfoEo0nF5jekBGU0v6z1NFCs6uXgCyQk1jQUjL4bbqnCX7GxEsoBw";
const DEV_VECTOR =
  "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6ImNwLXRlc3QtMSJ9." +
  "eyJhdWQiOiJtYXJrZXRwbGFjZSIsInN1YiI6ImFjY291bnQ6ajU3YWJjIiwiaWF0IjoxNzYwMDAwMDAwLCJleHAiOjE3NjAwMDAzMDAsInRpZXIiOiJkZXYifQ." +
  "5d6JIrnTy67uzjc9EX6gKA6HqCfNefYeKCzhcc0iGre7yigIKp3qK_fvJ6EKe-_ULwIroDOGWNz9sRHVIAv4CA";

function decodeJson(segment: string): Record<string, unknown> {
  const bytes = base64UrlDecode(segment);
  if (!bytes) {
    throw new Error(`not base64url: ${segment}`);
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

/** The marketplace's signature check: Ed25519 over `header.claims` with the raw public key. */
async function verifySignature(token: string, publicKey: string): Promise<boolean> {
  const [header, claims, signature] = token.split(".");
  const raw = base64UrlDecode(publicKey);
  const sig = base64UrlDecode(signature);
  if (!raw || !sig) {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, new Uint8Array(sig), new TextEncoder().encode(`${header}.${claims}`));
}

describe("mintBuyerToken", () => {
  it("produces the pinned tokens the marketplace verifier accepts", async () => {
    const key = await importBuyerSigningKey(TEST_KID, TEST_JWK);
    expect(await mintBuyerToken(BUYER, "public", key, NOW_MS)).toBe(PUBLIC_VECTOR);
    expect(await mintBuyerToken(BUYER, "dev", key, NOW_MS)).toBe(DEV_VECTOR);
  });

  it("is a compact JWS of unpadded base64url segments with a valid Ed25519 signature", async () => {
    const key = await importBuyerSigningKey(TEST_KID, TEST_JWK);
    const token = await mintBuyerToken(BUYER, "public", key, NOW_MS);
    const segments = token.split(".");
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(base64UrlDecode(segments[2])).toHaveLength(64);
    expect(await verifySignature(token, TEST_PUBLIC_KEY)).toBe(true);
  });

  it("writes exactly the header the marketplace pins", async () => {
    const key = await importBuyerSigningKey(TEST_KID, TEST_JWK);
    const header = decodeJson((await mintBuyerToken(BUYER, "dev", key, NOW_MS)).split(".")[0]);
    expect(header).toEqual({ alg: "EdDSA", typ: "JWT", kid: TEST_KID });
  });

  it("writes the audience, subject and a five-minute window in whole seconds", async () => {
    const key = await importBuyerSigningKey(TEST_KID, TEST_JWK);
    const claims = decodeJson((await mintBuyerToken(BUYER, "public", key, NOW_MS + 999)).split(".")[1]);
    expect(claims).toEqual({ aud: "marketplace", sub: BUYER, iat: 1_760_000_000, exp: 1_760_000_300 });
    expect((claims.exp as number) - (claims.iat as number)).toBe(BUYER_TOKEN_LIFETIME_SECONDS);
    expect(BUYER_TOKEN_LIFETIME_SECONDS).toBeLessThanOrEqual(300);
  });

  it("carries tier dev only for dev access", async () => {
    const key = await importBuyerSigningKey(TEST_KID, TEST_JWK);
    const dev = decodeJson((await mintBuyerToken(BUYER, "dev", key, NOW_MS)).split(".")[1]);
    const pub = decodeJson((await mintBuyerToken(BUYER, "public", key, NOW_MS)).split(".")[1]);
    expect(dev.tier).toBe("dev");
    expect("tier" in pub).toBe(false);
  });

  it("fails to verify under another key or with altered claims", async () => {
    const key = await importBuyerSigningKey(TEST_KID, TEST_JWK);
    const token = await mintBuyerToken(BUYER, "public", key, NOW_MS);
    const other = await generateBuyerSigningKey("other");
    expect(await verifySignature(token, other.controlPlanePublicKey.split(":")[1])).toBe(false);

    const [header, , signature] = token.split(".");
    const forged = `${header}.${DEV_VECTOR.split(".")[1]}.${signature}`;
    expect(await verifySignature(forged, TEST_PUBLIC_KEY)).toBe(false);
  });
});

describe("buyerTokenClaims", () => {
  it("refuses a subject that is not account:{id}", () => {
    expect(() => buyerTokenClaims("user:1", "public", NOW_MS)).toThrow("account:{id}");
    expect(() => buyerTokenClaims("account:", "public", NOW_MS)).toThrow("account:{id}");
  });
});

describe("importBuyerSigningKey", () => {
  it("refuses a key id the marketplace's key list cannot hold", async () => {
    await expect(importBuyerSigningKey("a:b", TEST_JWK)).rejects.toThrow("MARKETPLACE_BUYER_SIGNING_KEY_ID");
    await expect(importBuyerSigningKey("a,b", TEST_JWK)).rejects.toThrow("MARKETPLACE_BUYER_SIGNING_KEY_ID");
    await expect(importBuyerSigningKey("", TEST_JWK)).rejects.toThrow("MARKETPLACE_BUYER_SIGNING_KEY_ID");
  });

  it("refuses a key that is not an Ed25519 private JWK", async () => {
    await expect(importBuyerSigningKey(TEST_KID, "not json")).rejects.toThrow("MARKETPLACE_BUYER_SIGNING_KEY");
    await expect(
      importBuyerSigningKey(TEST_KID, JSON.stringify({ kty: "OKP", crv: "Ed25519", x: TEST_PUBLIC_KEY }))
    ).rejects.toThrow("MARKETPLACE_BUYER_SIGNING_KEY");
    await expect(
      importBuyerSigningKey(TEST_KID, JSON.stringify({ kty: "EC", crv: "P-256", d: "a", x: "b" }))
    ).rejects.toThrow("MARKETPLACE_BUYER_SIGNING_KEY");
  });

  it("ignores export metadata such as key_ops and ext", async () => {
    const withMetadata = JSON.stringify({ ...JSON.parse(TEST_JWK), key_ops: ["sign"], ext: true, alg: "Ed25519" });
    const key = await importBuyerSigningKey(TEST_KID, withMetadata);
    expect(await mintBuyerToken(BUYER, "public", key, NOW_MS)).toBe(PUBLIC_VECTOR);
  });
});

describe("buyerSigningKeyFromEnv", () => {
  it("names both variables when either is missing", async () => {
    const message = "set MARKETPLACE_BUYER_SIGNING_KEY and MARKETPLACE_BUYER_SIGNING_KEY_ID";
    await expect(buyerSigningKeyFromEnv({})).rejects.toThrow(message);
    await expect(buyerSigningKeyFromEnv({ MARKETPLACE_BUYER_SIGNING_KEY: TEST_JWK })).rejects.toThrow(message);
    await expect(buyerSigningKeyFromEnv({ MARKETPLACE_BUYER_SIGNING_KEY_ID: TEST_KID })).rejects.toThrow(message);
  });

  it("imports the configured key", async () => {
    const key = await buyerSigningKeyFromEnv({
      MARKETPLACE_BUYER_SIGNING_KEY: TEST_JWK,
      MARKETPLACE_BUYER_SIGNING_KEY_ID: TEST_KID,
    });
    expect(key.kid).toBe(TEST_KID);
    expect(await mintBuyerToken(BUYER, "dev", key, NOW_MS)).toBe(DEV_VECTOR);
  });
});

describe("generateBuyerSigningKey", () => {
  it("prints a public key entry that verifies the private key's tokens", async () => {
    const generated = await generateBuyerSigningKey("cp-2026-10");
    const [kid, publicKey] = generated.controlPlanePublicKey.split(":");
    expect(kid).toBe("cp-2026-10");
    expect(base64UrlDecode(publicKey)).toHaveLength(32);
    expect(publicKey).not.toContain("=");

    const key = await importBuyerSigningKey(kid, generated.signingKeyJwk);
    expect(await verifySignature(await mintBuyerToken(BUYER, "public", key), publicKey)).toBe(true);
  });
});
