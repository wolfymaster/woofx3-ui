import { describe, expect, test } from "bun:test";
import {
  generateOpaqueToken,
  HANDOFF_TTL_MS,
  handoffRefusal,
  hashOpaqueToken,
  isOpaqueToken,
  signInNonceMatches,
} from "./oauthHandoff";

describe("generateOpaqueToken", () => {
  test("produces distinct 43-character base64url tokens", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const token = generateOpaqueToken();
      expect(isOpaqueToken(token)).toBe(true);
      seen.add(token);
    }
    expect(seen.size).toBe(50);
  });
});

describe("isOpaqueToken", () => {
  test("refuses anything that is not a generated token", () => {
    for (const value of [
      null,
      undefined,
      42,
      "",
      "short",
      `${"a".repeat(42)}=`,
      `${"a".repeat(42)}/`,
      "a".repeat(44),
    ]) {
      expect(isOpaqueToken(value)).toBe(false);
    }
  });
});

describe("hashOpaqueToken", () => {
  test("is a stable lowercase hex SHA-256 that differs from the token", async () => {
    const token = generateOpaqueToken();
    const hash = await hashOpaqueToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashOpaqueToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(await hashOpaqueToken(generateOpaqueToken())).not.toBe(hash);
  });

  test("matches a known digest", async () => {
    const token = "A".repeat(43);
    const expected = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    expect(await hashOpaqueToken(token)).toBe(expected);
  });

  test("refuses a value that is not an opaque token", async () => {
    await expect(hashOpaqueToken("not-a-token")).rejects.toThrow();
  });
});

describe("handoffRefusal", () => {
  const now = 1_000_000_000;
  const row = { provider: "twitch" as const, userId: "user-a", createdAt: now - 1000 };

  test("releases a fresh row to the user who started it", () => {
    expect(handoffRefusal(row, { provider: "twitch", userId: "user-a" }, now)).toBeNull();
  });

  test("a missing row or another provider's row is invalid", () => {
    expect(handoffRefusal(null, { provider: "twitch", userId: "user-a" }, now)).toBe("connect_code_invalid");
    expect(handoffRefusal(row, { provider: "module", userId: "user-a" }, now)).toBe("connect_code_invalid");
  });

  test("expires after the handoff lifetime", () => {
    const edge = { ...row, createdAt: now - HANDOFF_TTL_MS };
    expect(handoffRefusal(edge, { provider: "twitch", userId: "user-a" }, now)).toBeNull();
    const stale = { ...row, createdAt: now - HANDOFF_TTL_MS - 1 };
    expect(handoffRefusal(stale, { provider: "twitch", userId: "user-a" }, now)).toBe("connect_code_expired");
  });

  test("refuses a different signed-in user", () => {
    expect(handoffRefusal(row, { provider: "twitch", userId: "user-b" }, now)).toBe("wrong_user");
  });
});

describe("signInNonceMatches", () => {
  test("requires both hashes and equality", async () => {
    const hash = await hashOpaqueToken(generateOpaqueToken());
    const other = await hashOpaqueToken(generateOpaqueToken());
    expect(signInNonceMatches(hash, hash)).toBe(true);
    expect(signInNonceMatches(hash, other)).toBe(false);
    expect(signInNonceMatches(hash, null)).toBe(false);
    expect(signInNonceMatches(undefined, hash)).toBe(false);
    expect(signInNonceMatches("", "")).toBe(false);
    expect(signInNonceMatches(hash, hash.slice(1))).toBe(false);
  });
});
