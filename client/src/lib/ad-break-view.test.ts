import { describe, expect, test } from "bun:test";
import type { AdSchedule } from "@convex/lib/adBreaks";
import {
  type AdBreakInputs,
  type AdBreakView,
  adBreakView,
  applySnooze,
  countdownExpired,
  formatAgo,
  formatCountdown,
  runningAdFromBegin,
  scheduleFetch,
} from "./ad-break-view";

const NOW = Date.parse("2026-09-28T20:00:00Z");

function schedule(overrides: Partial<AdSchedule> = {}): AdSchedule {
  return {
    nextAdAt: "2026-09-28T20:05:00.000Z",
    lastAdAt: "2026-09-28T19:30:00.000Z",
    durationSeconds: 90,
    prerollFreeSeconds: 600,
    snoozeCount: 2,
    snoozeRefreshAt: "2026-09-28T20:30:00.000Z",
    serverNow: "2026-09-28T20:00:00.000Z",
    ...overrides,
  };
}

function okFetch(value: AdSchedule, receivedAt = NOW) {
  return scheduleFetch(value, receivedAt);
}

function inputs(overrides: Partial<AdBreakInputs> = {}): AdBreakInputs {
  return {
    live: true,
    scopeGranted: true,
    fetch: okFetch(schedule()),
    running: null,
    now: NOW,
    ...overrides,
  };
}

describe("formatCountdown", () => {
  test("minutes and seconds under an hour", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(125)).toBe("2:05");
    expect(formatCountdown(3599)).toBe("59:59");
  });

  test("hours once past one", () => {
    expect(formatCountdown(3600)).toBe("1:00:00");
    expect(formatCountdown(3725)).toBe("1:02:05");
  });

  test("never negative or fractional", () => {
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(61.9)).toBe("1:01");
  });
});

describe("formatAgo", () => {
  test("coarse units", () => {
    expect(formatAgo(30)).toBe("just now");
    expect(formatAgo(125)).toBe("2m ago");
    expect(formatAgo(3 * 3600 + 5 * 60)).toBe("3h 5m ago");
  });
});

describe("adBreakView", () => {
  test("waits for the live state before saying anything", () => {
    expect(adBreakView(inputs({ live: undefined }))).toEqual({ kind: "loading" });
  });

  test("offline wins over everything, a running ad included", () => {
    const view = adBreakView(
      inputs({ live: false, scopeGranted: false, running: { startedAt: NOW, durationSeconds: 60 } })
    );
    expect(view).toEqual({ kind: "offline" });
  });

  test("a missing scope wins over what Twitch said", () => {
    expect(adBreakView(inputs({ scopeGranted: false }))).toEqual({ kind: "scopeMissing" });
  });

  test("fetch errors and loading pass through", () => {
    expect(adBreakView(inputs({ fetch: { status: "error", message: "boom" } }))).toEqual({
      kind: "error",
      message: "boom",
    });
    expect(adBreakView(inputs({ fetch: { status: "loading" } }))).toEqual({ kind: "loading" });
  });

  test("the schedule, counted from now", () => {
    expect(adBreakView(inputs())).toEqual({
      kind: "scheduled",
      secondsUntilNext: 300,
      durationSeconds: 90,
      secondsSinceLast: 1800,
      prerollFreeSeconds: 600,
      snoozeCount: 2,
      secondsUntilSnoozeRefresh: 1800,
    });
  });

  test("preroll-free time runs down from when it was fetched", () => {
    const view = adBreakView(inputs({ now: NOW + 100_000 }));
    expect(view.kind === "scheduled" && view.prerollFreeSeconds).toBe(500);
    const later = adBreakView(inputs({ now: NOW + 1_000_000 }));
    expect(later.kind === "scheduled" && later.prerollFreeSeconds).toBe(0);
  });

  test("no scheduled ad and a full snooze count read as null, not zero", () => {
    const fetch = okFetch(schedule({ nextAdAt: null, lastAdAt: null, snoozeRefreshAt: null }));
    const view = adBreakView(inputs({ fetch }));
    expect(view).toMatchObject({ secondsUntilNext: null, secondsSinceLast: null, secondsUntilSnoozeRefresh: null });
  });

  test("an overdue ad counts down to zero rather than below", () => {
    const view = adBreakView(inputs({ now: Date.parse("2026-09-28T20:06:00Z") }));
    expect(view.kind === "scheduled" && view.secondsUntilNext).toBe(0);
  });

  test("a begin event shows the ad running until its length is up", () => {
    const running = { startedAt: NOW - 30_000, durationSeconds: 90 };
    expect(adBreakView(inputs({ running }))).toEqual({ kind: "running", secondsLeft: 60 });
    expect(adBreakView(inputs({ running, now: NOW + 60_000 })).kind).toBe("scheduled");
  });

  test("a begin event shows even before the first schedule arrives", () => {
    const running = { startedAt: NOW, durationSeconds: 30 };
    expect(adBreakView(inputs({ running, fetch: { status: "loading" } }))).toEqual({
      kind: "running",
      secondsLeft: 30,
    });
  });

  test("without events, a last ad still inside its length reads as running", () => {
    const fetch = okFetch(schedule({ lastAdAt: "2026-09-28T19:59:00Z", durationSeconds: 90 }));
    expect(adBreakView(inputs({ fetch }))).toEqual({ kind: "running", secondsLeft: 30 });
  });
});

describe("runningAdFromBegin", () => {
  test("reads the payload's start and length", () => {
    expect(
      runningAdFromBegin({ durationSeconds: 60, startedAt: "2026-09-28T20:00:00Z", isAutomatic: true }, 0)
    ).toEqual({ startedAt: NOW, durationSeconds: 60 });
  });

  test("falls back to receipt time for a missing start", () => {
    expect(runningAdFromBegin({ durationSeconds: 60 }, 123)).toEqual({ startedAt: 123, durationSeconds: 60 });
  });

  test("refuses a payload without a usable length", () => {
    expect(runningAdFromBegin({ durationSeconds: 0 }, 1)).toBeNull();
    expect(runningAdFromBegin({}, 1)).toBeNull();
    expect(runningAdFromBegin(null, 1)).toBeNull();
  });
});

describe("clock skew", () => {
  test("countdowns follow the backend's clock, anchored at receipt", () => {
    // The Convex backend's clock runs ten minutes ahead of the browser's.
    const skewed = schedule({
      serverNow: "2026-09-28T20:10:00.000Z",
      nextAdAt: "2026-09-28T20:15:00.000Z",
      lastAdAt: "2026-09-28T19:40:00.000Z",
      snoozeRefreshAt: "2026-09-28T20:40:00.000Z",
    });
    expect(adBreakView(inputs({ fetch: okFetch(skewed) }))).toMatchObject({
      secondsUntilNext: 300,
      secondsSinceLast: 1800,
      secondsUntilSnoozeRefresh: 1800,
    });
  });

  test("a snooze is placed with its own serverNow", () => {
    const before = okFetch(schedule());
    const after = applySnooze(
      before,
      {
        snoozeCount: 1,
        nextAdAt: "2026-09-28T21:10:00.000Z",
        snoozeRefreshAt: null,
        serverNow: "2026-09-28T21:00:00.000Z",
      },
      NOW
    );
    expect(adBreakView(inputs({ fetch: after }))).toMatchObject({
      secondsUntilNext: 600,
      snoozeCount: 1,
      secondsUntilSnoozeRefresh: null,
    });
  });
});

describe("countdownExpired", () => {
  const scheduled = (secondsUntilNext: number | null, secondsUntilSnoozeRefresh: number | null): AdBreakView => ({
    kind: "scheduled",
    secondsUntilNext,
    durationSeconds: 90,
    secondsSinceLast: null,
    prerollFreeSeconds: 0,
    snoozeCount: 1,
    secondsUntilSnoozeRefresh,
  });

  test("fires once as the next ad or a snooze refill reaches zero", () => {
    expect(countdownExpired(scheduled(1, null), scheduled(0, null))).toBe(true);
    expect(countdownExpired(scheduled(0, null), scheduled(0, null))).toBe(false);
    expect(countdownExpired(scheduled(10, 1), scheduled(9, 0))).toBe(true);
    expect(countdownExpired(scheduled(10, null), scheduled(9, null))).toBe(false);
  });

  test("fires when a running ad ends", () => {
    expect(countdownExpired({ kind: "running", secondsLeft: 1 }, scheduled(900, null))).toBe(true);
  });

  test("never on the first view", () => {
    expect(countdownExpired(null, scheduled(0, null))).toBe(false);
  });
});
