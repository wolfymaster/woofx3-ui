import { describe, expect, test } from "bun:test";
import { engineReleaseNotesUrl, formatEngineVersion } from "./engine-version";

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

describe("engineReleaseNotesUrl", () => {
  test("links a release tag verbatim", () => {
    expect(engineReleaseNotesUrl("v0.1.0")).toBe("https://github.com/wolfymaster/woofx3/releases/tag/v0.1.0");
    expect(engineReleaseNotesUrl("v1.2.3-rc.1")).toBe("https://github.com/wolfymaster/woofx3/releases/tag/v1.2.3-rc.1");
  });

  test("has no link for preview and dev builds", () => {
    expect(engineReleaseNotesUrl("pr-12-abc1234")).toBeNull();
    expect(engineReleaseNotesUrl("dev")).toBeNull();
  });

  test("has no link when the version is unknown", () => {
    expect(engineReleaseNotesUrl(null)).toBeNull();
    expect(engineReleaseNotesUrl("")).toBeNull();
    expect(engineReleaseNotesUrl("   ")).toBeNull();
  });
});
