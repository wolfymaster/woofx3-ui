import { describe, expect, test } from "bun:test";
import {
  companionsReplacedBy,
  hashCompanionToken,
  isCompanionToken,
  isInstallationId,
  isSha256Hex,
  isValidCompanionVersion,
  MAX_COMPANION_VERSION_LENGTH,
} from "./companionCodes";

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

describe("companionsReplacedBy", () => {
  const rows = [
    { id: "a", installationId: "install-a" },
    { id: "b", installationId: "install-b" },
  ];

  test("replaces another installation's companion", () => {
    expect(companionsReplacedBy(rows, "install-c").map((row) => row.id)).toEqual(["a", "b"]);
  });

  test("keeps the same installation's companion, which is updated in place", () => {
    expect(companionsReplacedBy(rows, "install-a").map((row) => row.id)).toEqual(["b"]);
  });

  test("replaces nothing on an instance with no companion", () => {
    expect(companionsReplacedBy([], "install-a")).toEqual([]);
  });
});
