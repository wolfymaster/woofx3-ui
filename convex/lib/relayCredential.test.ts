import { describe, expect, test } from "bun:test";
import { parseRelaySigningKey, type RelayClaims, signRelayCredential, verifyRelayCredential } from "./relayCredential";

// Must match RELAY_CREDENTIAL_VECTOR in woofx3-maintenance worker/test/vector.ts. The
// signature was also checked independently with
// `openssl dgst -sha256 -mac HMAC -macopt hexkey:000102…1f`.
const RELAY_CREDENTIAL_VECTOR = {
  keys: "k1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  claims: {
    v: 1,
    aud: "engine",
    ins: "j57abc",
    host: "c-abcdefghijkl.woofx3.tv",
    iat: 1700000000,
    exp: 1700000300,
  } satisfies RelayClaims,
  credential:
    "wfxr1.k1.eyJ2IjoxLCJhdWQiOiJlbmdpbmUiLCJpbnMiOiJqNTdhYmMiLCJob3N0IjoiYy1hYmNkZWZnaGlqa2wud29vZngzLnR2IiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMDAzMDB9.t_q6wJm6Cem-CaVVzd0uALsQXOBNuWsZEkAwvhEgFeE",
};

/** The companion-audience counterpart, with `cid` between `host` and `iat`. */
const COMPANION_VECTOR = {
  claims: {
    v: 1,
    aud: "companion",
    ins: "j57abc",
    host: "c-abcdefghijkl.woofx3.tv",
    cid: "k97def",
    iat: 1700000000,
    exp: 1700000300,
  } satisfies RelayClaims,
  credential:
    "wfxr1.k1.eyJ2IjoxLCJhdWQiOiJjb21wYW5pb24iLCJpbnMiOiJqNTdhYmMiLCJob3N0IjoiYy1hYmNkZWZnaGlqa2wud29vZngzLnR2IiwiY2lkIjoiazk3ZGVmIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMDAzMDB9.vgwWw1s0P1VpdCLGpfU41mpNrlkEEKn0idE8CSMIBwc",
};

function vectorKey() {
  const [id, encoded] = RELAY_CREDENTIAL_VECTOR.keys.split(":");
  return parseRelaySigningKey(id, encoded);
}

function keyMap() {
  const key = vectorKey();
  return new Map([[key.id, key.secret]]);
}

describe("signRelayCredential", () => {
  test("produces the shared vector", async () => {
    expect(await signRelayCredential(RELAY_CREDENTIAL_VECTOR.claims, vectorKey())).toBe(
      RELAY_CREDENTIAL_VECTOR.credential
    );
  });

  test("puts cid between host and iat on a companion credential", async () => {
    expect(await signRelayCredential(COMPANION_VECTOR.claims, vectorKey())).toBe(COMPANION_VECTOR.credential);
  });

  test("orders keys the same whatever order the claims were built in", async () => {
    const shuffled = { exp: 1700000300, iat: 1700000000, host: "c-abcdefghijkl.woofx3.tv", ins: "j57abc" };
    const claims = { ...shuffled, aud: "engine", v: 1 } as RelayClaims;
    expect(await signRelayCredential(claims, vectorKey())).toBe(RELAY_CREDENTIAL_VECTOR.credential);
  });

  test("refuses a companion credential without a cid, and an engine credential with one", async () => {
    const { cid: _cid, ...noCid } = COMPANION_VECTOR.claims;
    await expect(signRelayCredential(noCid, vectorKey())).rejects.toThrow();
    await expect(signRelayCredential({ ...RELAY_CREDENTIAL_VECTOR.claims, cid: "x" }, vectorKey())).rejects.toThrow();
  });
});

describe("verifyRelayCredential", () => {
  const now = 1700000100;

  test("verifies the vector", async () => {
    expect(await verifyRelayCredential(RELAY_CREDENTIAL_VECTOR.credential, keyMap(), { aud: "engine" }, now)).toEqual(
      RELAY_CREDENTIAL_VECTOR.claims
    );
  });

  test("refuses a tampered, misaddressed or expired credential", async () => {
    const credential = RELAY_CREDENTIAL_VECTOR.credential;
    const flipped = `${credential.slice(0, -2)}${credential.endsWith("A") ? "B" : "A"}${credential.slice(-1)}`;
    expect(await verifyRelayCredential(flipped, keyMap(), { aud: "engine" }, now)).toBeNull();
    expect(await verifyRelayCredential(credential.replace("k1", "k2"), keyMap(), { aud: "engine" }, now)).toBeNull();
    expect(await verifyRelayCredential(credential, keyMap(), { aud: "companion" }, now)).toBeNull();
    expect(await verifyRelayCredential(credential, keyMap(), { aud: "engine" }, 1700000300)).toBeNull();
    expect(await verifyRelayCredential(credential, keyMap(), { aud: "engine" }, 1699999999)).toBeNull();
  });
});

describe("parseRelaySigningKey", () => {
  test("refuses a short key or a bad id", () => {
    expect(() => parseRelaySigningKey("k1", "AAECAw")).toThrow();
    expect(() => parseRelaySigningKey("k:1", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")).toThrow();
  });
});
