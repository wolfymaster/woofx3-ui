import { describe, expect, test } from "bun:test";
import {
  formatUserCode,
  generateUserCode,
  hashCompanionToken,
  isCompanionToken,
  isInstallationId,
  isSha256Hex,
  isValidCompanionVersion,
  MAX_COMPANION_VERSION_LENGTH,
  normalizeUserCode,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
} from "./companionCodes";

function sequenceFiller(values: number[]) {
  let index = 0;
  return (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = values[index % values.length];
      index += 1;
    }
  };
}

describe("generateUserCode", () => {
  test("draws every character from the alphabet", () => {
    const code = generateUserCode((bytes) => crypto.getRandomValues(bytes));
    expect(code).toHaveLength(USER_CODE_LENGTH);
    for (const ch of code) {
      expect(USER_CODE_ALPHABET).toContain(ch);
    }
  });

  test("rejects bytes that would bias the distribution", () => {
    // Bytes at or above 243 (9 × 27) are redrawn, so 243 and 255 are skipped.
    const code = generateUserCode(sequenceFiller([243, 255, 0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toBe("BCDFGHJK");
  });
});

describe("normalizeUserCode", () => {
  test("accepts the displayed form, lower case and stray spaces", () => {
    expect(normalizeUserCode(" bcdf-ghjk ")).toBe("BCDFGHJK");
  });

  test("refuses wrong lengths and characters outside the alphabet", () => {
    expect(normalizeUserCode("BCDF-GHJ")).toBeNull();
    expect(normalizeUserCode("BCDF-GHJO")).toBeNull();
  });
});

test("formatUserCode splits into two groups of four", () => {
  expect(formatUserCode("BCDFGHJK")).toBe("BCDF-GHJK");
});

describe("companion tokens", () => {
  const token = `wfxc_${"A".repeat(43)}`;

  test("are the wfxc_ prefix and 43 base64url characters", () => {
    expect(isCompanionToken(token)).toBe(true);
    expect(isCompanionToken("A".repeat(43))).toBe(false);
    expect(isCompanionToken(`wfxc_${"A".repeat(42)}`)).toBe(false);
  });

  test("hash the whole token, prefix included", async () => {
    // Must match the same vector in companion/src-tauri/src/credentials.rs.
    expect(await hashCompanionToken(token)).toBe("7547593d4576d48baa7f1497270d794ccb7eb6d5524cb5346b4f57473e440775");
  });

  test("refuse to hash a value without the prefix", async () => {
    await expect(hashCompanionToken("A".repeat(43))).rejects.toThrow();
  });
});

test("isSha256Hex and isInstallationId accept only their lowercase shapes", () => {
  expect(isSha256Hex("a".repeat(64))).toBe(true);
  expect(isSha256Hex("A".repeat(64))).toBe(false);
  expect(isInstallationId("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
  expect(isInstallationId("not-a-uuid")).toBe(false);
});

test("isValidCompanionVersion bounds the length", () => {
  expect(isValidCompanionVersion("0.1.0")).toBe(true);
  expect(isValidCompanionVersion("")).toBe(false);
  expect(isValidCompanionVersion("1".repeat(MAX_COMPANION_VERSION_LENGTH + 1))).toBe(false);
});
