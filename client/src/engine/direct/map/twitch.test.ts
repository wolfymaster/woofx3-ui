import { describe, expect, test } from "bun:test";
import { isUnconfirmedWrite } from "@shared/twitch-helix-answer";
import { TWITCH_NOT_CONNECTED_MESSAGE } from "@shared/twitch-link-refusal";
import type { TwitchLinkInfo } from "@woofx3/api";
import { engineHelixAnswer, fromStreamInfoChanges, toCurrentPin, toModerationAccess, toStreamInfo } from "./twitch";

describe("engineHelixAnswer", () => {
  test("Twitch's answer is read as it was given", async () => {
    const { response, unconfirmed } = engineHelixAnswer({ ok: true, body: { data: [] } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(unconfirmed).toBeNull();
  });

  test.each([
    ["timeout", 504],
    ["failed", 502],
  ] as const)("a %s reads as a %d Twitch outage, saying why", (code, status) => {
    const { response, unconfirmed } = engineHelixAnswer({ ok: false, code, error: "engine trouble" });
    expect(response.status).toBe(status);
    expect(isUnconfirmedWrite(response)).toBe(true);
    expect(unconfirmed).toBe("engine trouble");
  });

  test.each([
    ["not_linked", TWITCH_NOT_CONNECTED_MESSAGE],
    ["unavailable", "The engine's Twitch connection is not running"],
    ["invalid_arguments", "The engine refused the call to Twitch: bad first"],
  ] as const)("a call the engine never sent (%s) rejects with why", (code, message) => {
    expect(() => engineHelixAnswer({ ok: false, code, error: "bad first" })).toThrow(message);
  });
});

describe("toModerationAccess", () => {
  const linked = (scopes: string[]): TwitchLinkInfo => ({
    linked: true,
    revision: 1,
    userId: "b-1",
    login: null,
    displayName: null,
    profileImageUrl: null,
    scopes,
    expiresAt: null,
    authFailedAt: null,
  });

  test.each([
    ["no link", { linked: false, revision: 1 } as TwitchLinkInfo, "not-linked", "not-linked"],
    ["a link without the scopes", linked([]), "needs-reconnect", "needs-reconnect"],
    ["a link with the ban scope", linked(["moderator:manage:banned_users"]), "ready", "needs-reconnect"],
  ])("%s", (_name, link, ban, chatSettings) => {
    const access = toModerationAccess(link);
    expect(access.ban).toBe(ban);
    expect(access.chatSettings).toBe(chatSettings);
  });

  test("the streamer is never refused by role", () => {
    expect(Object.values(toModerationAccess(linked(["moderator:manage:blocked_terms"])))).not.toContain("not-allowed");
  });
});

describe("stream info", () => {
  test("a category without art reads as null art, and back as none", () => {
    expect(toStreamInfo({ title: "t", category: { id: "1", name: "Chess" }, tags: [] })).toEqual({
      title: "t",
      category: { id: "1", name: "Chess", boxArtUrl: null },
      tags: [],
    });
    expect(fromStreamInfoChanges({ category: { id: "1", name: "Chess", boxArtUrl: null } })).toEqual({
      category: { id: "1", name: "Chess" },
    });
  });

  test.each([
    ["only the fields given, a title trimmed", { title: " New " }, { title: "New" }],
    ["a cleared category", { category: null }, { category: null }],
    ["tags as given", { tags: ["a"] }, { tags: ["a"] }],
    ["nothing", {}, {}],
  ])("changes carry %s", (_name, changes, expected) => {
    expect(fromStreamInfoChanges(changes)).toEqual(expected);
  });
});

describe("toCurrentPin", () => {
  test("names the pin's text and sender", () => {
    expect(
      toCurrentPin({ messageId: "m", text: null, senderName: "S", pinnedAtMs: 1, endsAt: "2026-10-01T00:00:00Z" })
    ).toEqual({ messageId: "m", content: null, authorName: "S", expiresAt: "2026-10-01T00:00:00Z" });
  });
});
