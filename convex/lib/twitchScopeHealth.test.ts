import { describe, expect, test } from "bun:test";
import { TWITCH_INTEGRATION_SCOPES } from "./twitchIntegrationScopes";
import {
  missingRequiredTwitchScopes,
  missingTwitchCapabilities,
  TWITCH_CAPABILITIES,
  twitchScopeHealth,
  twitchScopeHealthKey,
} from "./twitchScopeHealth";

describe("TWITCH_CAPABILITIES", () => {
  test("every requested scope belongs to exactly one capability", () => {
    for (const scope of TWITCH_INTEGRATION_SCOPES) {
      const owners = TWITCH_CAPABILITIES.filter((capability) => capability.scopes.includes(scope));
      expect({ scope, owners: owners.length }).toEqual({ scope, owners: 1 });
    }
  });

  test("names no scope the app does not request", () => {
    const requested = new Set<string>(TWITCH_INTEGRATION_SCOPES);
    for (const capability of TWITCH_CAPABILITIES) {
      for (const scope of capability.scopes) {
        expect({ scope, requested: requested.has(scope) }).toEqual({ scope, requested: true });
      }
    }
  });
});

describe("missingTwitchCapabilities", () => {
  test("a link granted everything misses nothing", () => {
    expect(missingTwitchCapabilities([...TWITCH_INTEGRATION_SCOPES])).toEqual([]);
  });

  test("groups the absent scopes under the capability they belong to", () => {
    const granted = TWITCH_INTEGRATION_SCOPES.filter(
      (scope) => scope !== "moderator:manage:chat_messages" && scope !== "clips:edit"
    );
    expect(missingTwitchCapabilities(granted)).toEqual([
      { label: "Clips", optional: false, missingScopes: ["clips:edit"] },
      { label: "Pinned messages", optional: false, missingScopes: ["moderator:manage:chat_messages"] },
    ]);
  });

  test("flags optional capabilities as optional", () => {
    const granted = TWITCH_INTEGRATION_SCOPES.filter((scope) => scope !== "moderator:manage:chat_settings");
    expect(missingTwitchCapabilities(granted)).toEqual([
      { label: "Moderation: chat modes", optional: true, missingScopes: ["moderator:manage:chat_settings"] },
    ]);
  });

  test("a link made before the ad scopes misses only the optional Ad breaks capability", () => {
    const granted = TWITCH_INTEGRATION_SCOPES.filter(
      (scope) => scope !== "channel:read:ads" && scope !== "channel:manage:ads"
    );
    expect(missingTwitchCapabilities(granted)).toEqual([
      { label: "Ad breaks", optional: true, missingScopes: ["channel:read:ads", "channel:manage:ads"] },
    ]);
    expect(twitchScopeHealth({ scopes: granted })).toEqual({
      state: "ok",
      optionalMissing: [
        { label: "Ad breaks", optional: true, missingScopes: ["channel:read:ads", "channel:manage:ads"] },
      ],
    });
  });

  test("ignores extra scopes the link happens to hold", () => {
    expect(missingTwitchCapabilities([...TWITCH_INTEGRATION_SCOPES, "channel:manage:raids"])).toEqual([]);
  });

  test("only checks the scopes that are required", () => {
    expect(missingTwitchCapabilities([], ["clips:edit"])).toEqual([
      { label: "Clips", optional: false, missingScopes: ["clips:edit"] },
    ]);
  });
});

describe("twitchScopeHealth", () => {
  test("no link is unlinked, not missing everything", () => {
    expect(twitchScopeHealth(null)).toEqual({ state: "unlinked" });
    expect(twitchScopeHealth(undefined)).toEqual({ state: "unlinked" });
  });

  test("a refused token is revoked even when every scope was granted", () => {
    expect(twitchScopeHealth({ scopes: [...TWITCH_INTEGRATION_SCOPES], authFailedAt: 1 })).toEqual({
      state: "revoked",
    });
  });

  test("reports the missing capabilities of a live link", () => {
    const health = twitchScopeHealth({ scopes: TWITCH_INTEGRATION_SCOPES.filter((s) => s !== "clips:edit") });
    expect(health).toEqual({
      state: "missing",
      missing: [{ label: "Clips", optional: false, missingScopes: ["clips:edit"] }],
      optionalMissing: [],
    });
  });

  test("a complete live link is ok", () => {
    expect(twitchScopeHealth({ scopes: [...TWITCH_INTEGRATION_SCOPES] })).toEqual({ state: "ok", optionalMissing: [] });
  });

  test("a link missing only optional capabilities is ok and names them", () => {
    const health = twitchScopeHealth({
      scopes: TWITCH_INTEGRATION_SCOPES.filter((s) => s !== "moderator:manage:chat_settings"),
    });
    expect(health).toEqual({
      state: "ok",
      optionalMissing: [
        { label: "Moderation: chat modes", optional: true, missingScopes: ["moderator:manage:chat_settings"] },
      ],
    });
  });

  test("keeps optional gaps apart from required ones", () => {
    const health = twitchScopeHealth({
      scopes: TWITCH_INTEGRATION_SCOPES.filter((s) => s !== "moderator:manage:chat_settings" && s !== "clips:edit"),
    });
    expect(health).toEqual({
      state: "missing",
      missing: [{ label: "Clips", optional: false, missingScopes: ["clips:edit"] }],
      optionalMissing: [
        { label: "Moderation: chat modes", optional: true, missingScopes: ["moderator:manage:chat_settings"] },
      ],
    });
  });
});

describe("twitchScopeHealthKey", () => {
  test("changes when the set of missing scopes changes", () => {
    const one = twitchScopeHealth({ scopes: TWITCH_INTEGRATION_SCOPES.filter((s) => s !== "clips:edit") });
    const two = twitchScopeHealth({
      scopes: TWITCH_INTEGRATION_SCOPES.filter((s) => s !== "clips:edit" && s !== "user:bot"),
    });
    expect(twitchScopeHealthKey(one)).not.toBe(twitchScopeHealthKey(two));
    expect(twitchScopeHealthKey(one)).toBe(twitchScopeHealthKey(one));
  });

  test("ignores optional gaps, so granting one does not re-show a dismissed banner", () => {
    const withOptionalGap = twitchScopeHealth({
      scopes: TWITCH_INTEGRATION_SCOPES.filter((s) => s !== "clips:edit" && s !== "moderator:manage:chat_settings"),
    });
    const withoutOptionalGap = twitchScopeHealth({
      scopes: TWITCH_INTEGRATION_SCOPES.filter((s) => s !== "clips:edit"),
    });
    expect(twitchScopeHealthKey(withOptionalGap)).toBe(twitchScopeHealthKey(withoutOptionalGap));
  });

  test("distinguishes revoked from missing", () => {
    expect(twitchScopeHealthKey({ state: "revoked" })).toBe("revoked");
  });
});

describe("missingRequiredTwitchScopes", () => {
  test("leaves out the scopes of optional capabilities", () => {
    const optionalScopes = TWITCH_CAPABILITIES.filter((capability) => capability.optional).flatMap(
      (capability) => capability.scopes
    );
    expect(optionalScopes.length).toBeGreaterThan(0);
    const allButOptional = TWITCH_INTEGRATION_SCOPES.filter((scope) => !optionalScopes.includes(scope));
    expect(missingRequiredTwitchScopes(allButOptional)).toEqual([]);
  });

  test("names the required scopes a link lacks", () => {
    const withoutClips = TWITCH_INTEGRATION_SCOPES.filter((scope) => scope !== "clips:edit");
    expect(missingRequiredTwitchScopes(withoutClips)).toEqual(["clips:edit"]);
  });
});
