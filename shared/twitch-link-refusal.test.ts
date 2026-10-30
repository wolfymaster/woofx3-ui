import { describe, expect, test } from "bun:test";
import { missingTwitchScopeMessage, TWITCH_NOT_CONNECTED_MESSAGE, twitchLinkRefusal } from "./twitch-link-refusal";

describe("twitchLinkRefusal", () => {
  const cases: Array<{
    name: string;
    link: { scopes: string[] } | null;
    scope: string | null;
    refusal: string | null;
  }> = [
    { name: "a link holding the scope", link: { scopes: ["a", "b"] }, scope: "b", refusal: null },
    { name: "a link without the scope", link: { scopes: ["a"] }, scope: "b", refusal: missingTwitchScopeMessage("b") },
    { name: "no link, a scope needed", link: null, scope: "b", refusal: missingTwitchScopeMessage("b") },
    { name: "no link, no scope needed", link: null, scope: null, refusal: TWITCH_NOT_CONNECTED_MESSAGE },
    { name: "any link, no scope needed", link: { scopes: [] }, scope: null, refusal: null },
  ];
  for (const { name, link, scope, refusal } of cases) {
    test(name, () => {
      expect(twitchLinkRefusal(link, scope)).toBe(refusal);
    });
  }
});
