import { describe, expect, test } from "bun:test";
import { formatEngineVersion } from "./engine-version";

describe("formatEngineVersion", () => {
  test("prefixes a bare release number", () => {
    expect(formatEngineVersion("0.2.1")).toBe("v0.2.1");
  });

  test("keeps a tag that already has its own prefix", () => {
    expect(formatEngineVersion("v0.2.1")).toBe("v0.2.1");
  });

  test("shows non-numeric builds as reported", () => {
    expect(formatEngineVersion("dev")).toBe("dev");
    expect(formatEngineVersion("image-check-abc1234")).toBe("image-check-abc1234");
  });

  test("shows a placeholder when the version is unknown", () => {
    expect(formatEngineVersion(null)).toBe("v—");
    expect(formatEngineVersion("")).toBe("v—");
    expect(formatEngineVersion("   ")).toBe("v—");
  });
});
