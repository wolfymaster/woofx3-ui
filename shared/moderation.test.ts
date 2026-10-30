import { describe, expect, test } from "bun:test";
import {
  addedBlockedTerm,
  BLOCKED_TERMS_MAX_PAGES,
  capabilityStatus,
  chatSettingsFromHelix,
  chatSettingsToHelix,
  collectBlockedTerms,
  describeModerationError,
  formatDuration,
  helixErrorMessage,
  MODERATION_SCOPES,
  moderationAccess,
  parseDuration,
  readModerationAnswer,
  resolveModerationTarget,
  validateBanReason,
  validateBlockedTerm,
  validateTimeoutSeconds,
} from "./moderation";

const ALL_SCOPES = Object.values(MODERATION_SCOPES);
const TODAYS_SCOPES = [MODERATION_SCOPES.blockedTerms, MODERATION_SCOPES.bans, MODERATION_SCOPES.readChatSettings];

describe("capabilityStatus", () => {
  test("everything is not-linked without a Twitch link", () => {
    expect(moderationAccess("owner", null)).toEqual({
      addBlockedTerm: "not-linked",
      removeBlockedTerm: "not-linked",
      timeout: "not-linked",
      ban: "not-linked",
      chatSettings: "not-linked",
    });
  });

  test("an owner with every scope can do everything", () => {
    expect(moderationAccess("owner", ALL_SCOPES)).toEqual({
      addBlockedTerm: "ready",
      removeBlockedTerm: "ready",
      timeout: "ready",
      ban: "ready",
      chatSettings: "ready",
    });
  });

  test("a member may time out and add terms but not remove terms, ban or lock down", () => {
    expect(moderationAccess("member", ALL_SCOPES)).toEqual({
      addBlockedTerm: "ready",
      removeBlockedTerm: "not-allowed",
      timeout: "ready",
      ban: "not-allowed",
      chatSettings: "not-allowed",
    });
  });

  test("a link granted before the chat settings scope needs a reconnect for lockdown only", () => {
    expect(moderationAccess("admin", TODAYS_SCOPES)).toEqual({
      addBlockedTerm: "ready",
      removeBlockedTerm: "ready",
      timeout: "ready",
      ban: "ready",
      chatSettings: "needs-reconnect",
    });
  });

  test("role is reported before scope, since reconnecting would not help", () => {
    expect(capabilityStatus("ban", "member", [])).toBe("not-allowed");
  });
});

describe("validateBlockedTerm", () => {
  test("trims and accepts 2..500 characters", () => {
    expect(validateBlockedTerm("  spam*  ")).toEqual({ ok: true, value: "spam*" });
    expect(validateBlockedTerm("ab").ok).toBe(true);
    expect(validateBlockedTerm("a".repeat(500)).ok).toBe(true);
  });

  test("refuses too short or too long", () => {
    expect(validateBlockedTerm(" a ").ok).toBe(false);
    expect(validateBlockedTerm("").ok).toBe(false);
    expect(validateBlockedTerm("a".repeat(501)).ok).toBe(false);
  });
});

describe("parseDuration", () => {
  test("bare numbers are seconds", () => {
    expect(parseDuration("90")).toBe(90);
  });

  test("units and combinations", () => {
    expect(parseDuration("90s")).toBe(90);
    expect(parseDuration("10m")).toBe(600);
    expect(parseDuration("1h30m")).toBe(5_400);
    expect(parseDuration("1h 30m")).toBe(5_400);
    expect(parseDuration("2D")).toBe(172_800);
    expect(parseDuration("1w")).toBe(604_800);
  });

  test("refuses what is not a duration", () => {
    for (const input of ["", "  ", "abc", "10x", "m10", "1.5h", "-5", "10m later"]) {
      expect(parseDuration(input)).toBeNull();
    }
  });
});

describe("validateTimeoutSeconds", () => {
  test("accepts one second to two weeks", () => {
    expect(validateTimeoutSeconds(1).ok).toBe(true);
    expect(validateTimeoutSeconds(1_209_600).ok).toBe(true);
  });

  test("refuses zero, fractions and more than two weeks", () => {
    expect(validateTimeoutSeconds(0).ok).toBe(false);
    expect(validateTimeoutSeconds(1.5).ok).toBe(false);
    expect(validateTimeoutSeconds(1_209_601).ok).toBe(false);
  });
});

describe("formatDuration", () => {
  test("drops zero parts", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(5_400)).toBe("1h 30m");
    expect(formatDuration(90_061)).toBe("1d 1h 1m 1s");
    expect(formatDuration(0)).toBe("0s");
  });
});

describe("validateBanReason", () => {
  test("allows an empty reason and caps at 500", () => {
    expect(validateBanReason("  ")).toEqual({ ok: true, value: "" });
    expect(validateBanReason("a".repeat(500)).ok).toBe(true);
    expect(validateBanReason("a".repeat(501)).ok).toBe(false);
  });
});

describe("chat settings", () => {
  test("reads Helix's shape, with null durations while a mode is off", () => {
    const settings = chatSettingsFromHelix({
      data: [
        {
          emote_mode: false,
          follower_mode: true,
          follower_mode_duration: 10,
          slow_mode: false,
          slow_mode_wait_time: null,
          subscriber_mode: true,
        },
      ],
    });
    expect(settings).toEqual({
      emoteMode: false,
      followerMode: true,
      followerModeDuration: 10,
      slowMode: false,
      slowModeWaitTime: null,
      subscriberMode: true,
    });
    expect(chatSettingsFromHelix({ data: [] })).toBeNull();
  });

  test("sends only the fields being changed", () => {
    expect(chatSettingsToHelix({ emoteMode: true })).toEqual({ ok: true, value: { emote_mode: true } });
    expect(chatSettingsToHelix({ slowMode: true, slowModeWaitTime: 30 })).toEqual({
      ok: true,
      value: { slow_mode: true, slow_mode_wait_time: 30 },
    });
    expect(chatSettingsToHelix({ followerMode: true, followerModeDuration: 0 })).toEqual({
      ok: true,
      value: { follower_mode: true, follower_mode_duration: 0 },
    });
  });

  test("refuses out-of-range values and an empty change", () => {
    expect(chatSettingsToHelix({ slowMode: true, slowModeWaitTime: 2 }).ok).toBe(false);
    expect(chatSettingsToHelix({ slowMode: true, slowModeWaitTime: 121 }).ok).toBe(false);
    expect(chatSettingsToHelix({ followerMode: true, followerModeDuration: 129_601 }).ok).toBe(false);
    expect(chatSettingsToHelix({}).ok).toBe(false);
  });
});

describe("describeModerationError", () => {
  test("pulls the message out of a Helix error body", () => {
    expect(helixErrorMessage('{"error":"Bad Request","status":400,"message":"nope"}')).toBe("nope");
    expect(helixErrorMessage("<html>")).toBe("");
  });

  test("names an account Twitch will not ban", () => {
    expect(describeModerationError("ban", 400, "The user specified in the user_id field may not be banned.")).toBe(
      "Twitch won't let that account be banned or timed out."
    );
  });

  test("already banned and not banned", () => {
    expect(describeModerationError("ban", 400, "The user specified in the user_id field is already banned.")).toBe(
      "That user is already banned."
    );
    expect(describeModerationError("unban", 400, "The user specified in the user_id field is not banned.")).toBe(
      "That user is not banned or timed out."
    );
  });

  test("status codes that mean the same thing everywhere", () => {
    expect(describeModerationError("add-term", 401, "")).toContain("Reconnect Twitch");
    expect(describeModerationError("timeout", 429, "")).toContain("rate-limiting");
    expect(describeModerationError("update-settings", 409, "")).toContain("same moment");
  });

  test("falls back to Twitch's own words", () => {
    expect(describeModerationError("add-term", 400, "The text field is required.")).toBe(
      "Blocking that term failed: The text field is required."
    );
    expect(describeModerationError("remove-term", 500, "")).toBe("Removing that term failed (Twitch 500).");
  });
});

describe("readModerationAnswer", () => {
  test("a body is its JSON and a 204 is null", async () => {
    expect(await readModerationAnswer("ban", new Response('{"data":[]}', { status: 200 }))).toEqual({ data: [] });
    expect(await readModerationAnswer("unban", new Response(null, { status: 204 }))).toBeNull();
  });

  test("a refusal throws its sentence", async () => {
    const refused = new Response('{"message":"user is already banned"}', { status: 400 });
    const error = await readModerationAnswer("ban", refused).catch((e: Error) => e);
    expect(String(error)).toContain("That user is already banned.");
  });
});

describe("collectBlockedTerms", () => {
  const page = (id: string, cursor?: string) => ({
    data: [{ id, text: `term ${id}`, created_at: "2026-10-01T00:00:00Z" }],
    pagination: cursor ? { cursor } : {},
  });

  test("follows the cursor until Twitch stops giving one", async () => {
    const asked: Array<string | undefined> = [];
    const result = await collectBlockedTerms(async (cursor) => {
      asked.push(cursor);
      return cursor === undefined ? page("1", "next") : page("2");
    });
    expect(asked).toEqual([undefined, "next"]);
    expect(result).toEqual({
      terms: [
        { id: "1", text: "term 1", createdAt: "2026-10-01T00:00:00Z", expiresAt: null },
        { id: "2", text: "term 2", createdAt: "2026-10-01T00:00:00Z", expiresAt: null },
      ],
      truncated: false,
    });
  });

  test("stops at the page bound and says the list is truncated", async () => {
    let pages = 0;
    const result = await collectBlockedTerms(async () => {
      pages++;
      return page(String(pages), "more");
    });
    expect(pages).toBe(BLOCKED_TERMS_MAX_PAGES);
    expect(result.truncated).toBe(true);
  });

  test("an added term is the answer's first, or null", () => {
    expect(addedBlockedTerm(page("9"))?.id).toBe("9");
    expect(addedBlockedTerm({ data: [] })).toBeNull();
  });
});

describe("resolveModerationTarget", () => {
  const viewer = { twitchUserId: "2", login: "someone", displayName: "SomeOne" };
  const lookup = async (login: string) =>
    login === "someone" ? viewer : login === "me" ? { ...viewer, twitchUserId: "1" } : null;

  const refusals: Array<{ input: string; message: string }> = [
    { input: " not a login! ", message: '"not a login!" is not a Twitch username' },
    { input: "nobody", message: 'No Twitch user called "nobody"' },
    { input: "me", message: "You can't moderate your own account" },
  ];
  for (const { input, message } of refusals) {
    test(`refuses ${JSON.stringify(input)}`, async () => {
      const error = await resolveModerationTarget(input, "1", lookup).catch((e: Error) => e);
      expect(String(error)).toContain(message);
    });
  }

  test("finds a typed login with its @ and case", async () => {
    expect(await resolveModerationTarget("@SomeOne", "1", lookup)).toEqual(viewer);
  });
});
