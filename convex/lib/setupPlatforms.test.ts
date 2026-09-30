import { describe, expect, test } from "bun:test";
import {
  type CuratedSetupPlatform,
  curatedSetupPlatformError,
  DEFAULT_SETUP_PLATFORMS,
  resolveSetupPlatforms,
  type SetupPlatformListing,
} from "./setupPlatforms";

function curated(overrides: Partial<CuratedSetupPlatform> & { marketplaceModuleId: string }): CuratedSetupPlatform {
  return { required: false, defaultSelected: false, sortOrder: 0, summary: "summary", ...overrides };
}

function listed(id: string): SetupPlatformListing {
  return { id, name: `${id} name`, description: `${id} description`, version: "1.0.0" };
}

describe("resolveSetupPlatforms", () => {
  test("returns curated platforms in sortOrder with marketplace fields and permissions", () => {
    const result = resolveSetupPlatforms(
      [
        curated({ marketplaceModuleId: "b", sortOrder: 20 }),
        curated({ marketplaceModuleId: "a", sortOrder: 10, required: true, defaultSelected: true }),
      ],
      [listed("a"), listed("b"), listed("not-curated")],
      new Map([
        ["a", ["twitch.channel"]],
        ["b", []],
      ])
    );

    expect(result.unavailableRequired).toEqual([]);
    expect(result.platforms.map((p) => p.marketplaceModuleId)).toEqual(["a", "b"]);
    expect(result.platforms[0]).toEqual({
      marketplaceModuleId: "a",
      name: "a name",
      description: "a description",
      summary: "summary",
      version: "1.0.0",
      required: true,
      defaultSelected: true,
      permissions: ["twitch.channel"],
    });
  });

  test("hides an optional platform the marketplace does not list", () => {
    const result = resolveSetupPlatforms([curated({ marketplaceModuleId: "gone" })], [], new Map());
    expect(result).toEqual({ platforms: [], unavailableRequired: [] });
  });

  test("hides an optional platform whose permissions could not be read", () => {
    const result = resolveSetupPlatforms(
      [curated({ marketplaceModuleId: "a" })],
      [listed("a")],
      new Map([["a", null]])
    );
    expect(result).toEqual({ platforms: [], unavailableRequired: [] });
  });

  test("reports a required platform that cannot be resolved", () => {
    const result = resolveSetupPlatforms(
      [
        curated({ marketplaceModuleId: "unlisted", required: true, defaultSelected: true }),
        curated({ marketplaceModuleId: "unreadable", required: true, defaultSelected: true }),
      ],
      [listed("unreadable")],
      new Map([["unreadable", null]])
    );
    expect(result).toEqual({ platforms: [], unavailableRequired: ["unlisted", "unreadable"] });
  });

  test("always selects a required platform", () => {
    const result = resolveSetupPlatforms(
      [curated({ marketplaceModuleId: "a", required: true, defaultSelected: false })],
      [listed("a")],
      new Map([["a", []]])
    );
    expect(result.platforms[0]?.defaultSelected).toBe(true);
  });
});

describe("curatedSetupPlatformError", () => {
  test("accepts every default entry", () => {
    for (const entry of DEFAULT_SETUP_PLATFORMS) {
      expect(curatedSetupPlatformError(entry)).toBeNull();
    }
  });

  test("rejects a required platform that is not selected by default", () => {
    expect(curatedSetupPlatformError(curated({ marketplaceModuleId: "a", required: true }))).toBe(
      "a required platform must be selected by default"
    );
  });

  test("rejects a blank id or summary", () => {
    expect(curatedSetupPlatformError(curated({ marketplaceModuleId: " " }))).toBe("marketplaceModuleId is required");
    expect(curatedSetupPlatformError(curated({ marketplaceModuleId: "a", summary: "" }))).toBe("summary is required");
  });
});

describe("DEFAULT_SETUP_PLATFORMS", () => {
  test("requires Twitch and preselects nothing else", () => {
    const required = DEFAULT_SETUP_PLATFORMS.filter((p) => p.required).map((p) => p.marketplaceModuleId);
    const preselected = DEFAULT_SETUP_PLATFORMS.filter((p) => p.defaultSelected).map((p) => p.marketplaceModuleId);
    expect(required).toEqual(["woofx3_twitch"]);
    expect(preselected).toEqual(["woofx3_twitch"]);
  });
});
