import { describe, expect, test } from "bun:test";
import {
  AD_SCOPE_MISSING_MESSAGE,
  adHelixErrorMessage,
  helixErrorText,
  normalizeTimestamp,
  parseHelixAdSchedule,
  parseHelixBody,
  parseHelixSnoozeResult,
  toLocalTime,
} from "./adBreaks";

const SERVER_NOW = "2026-09-28T20:00:00.000Z";

function helixSchedule(overrides: Record<string, unknown> = {}) {
  return {
    data: [
      {
        next_ad_at: "2026-09-28T20:05:00Z",
        last_ad_at: "2026-09-28T19:30:00Z",
        duration: 90,
        preroll_free_time: 600,
        snooze_count: 2,
        snooze_refresh_at: "2026-09-28T20:30:00Z",
        ...overrides,
      },
    ],
  };
}

describe("parseHelixAdSchedule", () => {
  test("reads Get Ad Schedule's entry", () => {
    expect(parseHelixAdSchedule(helixSchedule(), SERVER_NOW)).toEqual({
      nextAdAt: "2026-09-28T20:05:00.000Z",
      lastAdAt: "2026-09-28T19:30:00.000Z",
      durationSeconds: 90,
      prerollFreeSeconds: 600,
      snoozeCount: 2,
      snoozeRefreshAt: "2026-09-28T20:30:00.000Z",
      serverNow: SERVER_NOW,
    });
  });

  test("takes epoch seconds as a number or a string, and 0 or empty for none", () => {
    const parsed = parseHelixAdSchedule(
      helixSchedule({ next_ad_at: 1790625900, last_ad_at: 0, snooze_refresh_at: "1790627400" }),
      SERVER_NOW
    );
    expect(parsed).toMatchObject({
      nextAdAt: "2026-09-28T20:05:00.000Z",
      lastAdAt: null,
      snoozeRefreshAt: "2026-09-28T20:30:00.000Z",
    });
    expect(parseHelixAdSchedule(helixSchedule({ next_ad_at: "" }), SERVER_NOW)?.nextAdAt).toBeNull();
  });

  test("refuses a malformed answer whole", () => {
    expect(parseHelixAdSchedule(helixSchedule({ next_ad_at: "soon" }), SERVER_NOW)).toBeNull();
    expect(parseHelixAdSchedule(helixSchedule({ snooze_count: -1 }), SERVER_NOW)).toBeNull();
    expect(parseHelixAdSchedule(helixSchedule({ duration: undefined }), SERVER_NOW)).toBeNull();
    expect(parseHelixAdSchedule({ data: [] }, SERVER_NOW)).toBeNull();
    expect(parseHelixAdSchedule("nope", SERVER_NOW)).toBeNull();
  });
});

describe("parseHelixSnoozeResult", () => {
  test("reads Snooze Next Ad's entry", () => {
    const body = { data: [{ snooze_count: 1, snooze_refresh_at: "", next_ad_at: 1790629200 }] };
    expect(parseHelixSnoozeResult(body, SERVER_NOW)).toEqual({
      snoozeCount: 1,
      snoozeRefreshAt: null,
      nextAdAt: "2026-09-28T21:00:00.000Z",
      serverNow: SERVER_NOW,
    });
  });

  test("refuses an entry without a count", () => {
    expect(parseHelixSnoozeResult({ data: [{ next_ad_at: "" }] }, SERVER_NOW)).toBeNull();
  });
});

describe("normalizeTimestamp", () => {
  test("zero means none", () => {
    expect(normalizeTimestamp(0)).toBeNull();
    expect(normalizeTimestamp("0")).toBeNull();
  });

  test("normalizes RFC3339 strings", () => {
    expect(normalizeTimestamp("2026-09-28T20:00:00Z")).toBe("2026-09-28T20:00:00.000Z");
  });
});

describe("toLocalTime", () => {
  test("keeps a time's distance from serverNow, anchored at receipt", () => {
    expect(toLocalTime("2026-09-28T20:05:00.000Z", SERVER_NOW, 1_000)).toBe(301_000);
    expect(toLocalTime(null, SERVER_NOW, 1_000)).toBeNull();
  });
});

describe("adHelixErrorMessage", () => {
  test("401 asks for a reconnect", () => {
    expect(adHelixErrorMessage("read", 401, "Invalid OAuth token")).toContain("Reconnect Twitch");
  });

  test("403, or a 401 naming a scope, means the ad scopes are missing", () => {
    expect(adHelixErrorMessage("read", 401, "Missing scope: channel:read:ads")).toBe(AD_SCOPE_MISSING_MESSAGE);
    expect(adHelixErrorMessage("snooze", 403, "Missing scope: channel:manage:ads")).toBe(AD_SCOPE_MISSING_MESSAGE);
  });

  test("a refused snooze shows Twitch's reason", () => {
    expect(adHelixErrorMessage("snooze", 400, "The channel has no snoozes remaining")).toBe(
      "The channel has no snoozes remaining"
    );
  });

  test("a snooze's 429 shows Twitch's reason, since Twitch also sends it when no snoozes are left", () => {
    expect(adHelixErrorMessage("snooze", 429, "The channel has no snoozes remaining")).toBe(
      "The channel has no snoozes remaining"
    );
    expect(adHelixErrorMessage("snooze", 429, "")).toBe(
      "Could not snooze the next ad: Twitch is rate-limiting this. Try again in a moment."
    );
  });

  test("429 reads as rate limited", () => {
    expect(adHelixErrorMessage("read", 429, "")).toBe(
      "Could not read the ad schedule: Twitch is rate-limiting this. Try again in a moment."
    );
  });

  test("anything else carries the status when Twitch gave no reason", () => {
    expect(adHelixErrorMessage("read", 500, "")).toBe("Could not read the ad schedule: Twitch answered 500");
  });
});

describe("parseHelixBody", () => {
  test("parses a JSON body", () => {
    expect(parseHelixBody("read", '{"data":[]}')).toEqual({ ok: true, body: { data: [] } });
  });

  test("turns a non-JSON body into a sentence", () => {
    expect(parseHelixBody("snooze", "<html>Bad Gateway</html>")).toEqual({
      ok: false,
      message: "Could not snooze the next ad: Twitch answered with something that is not JSON.",
    });
  });
});

describe("helixErrorText", () => {
  test("prefers the body's message", () => {
    expect(helixErrorText('{"error":"Bad Request","status":400,"message":"channel is not live"}')).toBe(
      "channel is not live"
    );
    expect(helixErrorText("upstream timeout ")).toBe("upstream timeout");
  });
});
