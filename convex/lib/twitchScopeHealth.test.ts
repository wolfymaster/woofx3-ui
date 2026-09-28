import { describe, expect, test } from "bun:test";
import { TWITCH_INTEGRATION_SCOPES } from "./twitchIntegrationScopes";
import {
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
      { label: "Clips", missingScopes: ["clips:edit"] },
      { label: "Pinned messages", missingScopes: ["moderator:manage:chat_messages"] },
    ]);
  });

  test("ignores extra scopes the link happens to hold", () => {
    expect(missingTwitchCapabilities([...TWITCH_INTEGRATION_SCOPES, "channel:manage:raids"])).toEqual([]);
  });

  test("only checks the scopes that are required", () => {
    expect(missingTwitchCapabilities([], ["clips:edit"])).toEqual([{ label: "Clips", missingScopes: ["clips:edit"] }]);
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
    expect(health).toEqual({ state: "missing", missing: [{ label: "Clips", missingScopes: ["clips:edit"] }] });
  });

  test("a complete live link is ok", () => {
    expect(twitchScopeHealth({ scopes: [...TWITCH_INTEGRATION_SCOPES] })).toEqual({ state: "ok" });
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

  test("distinguishes revoked from missing", () => {
    expect(twitchScopeHealthKey({ state: "revoked" })).toBe("revoked");
  });
});
