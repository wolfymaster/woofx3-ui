import { describe, expect, test } from "bun:test";
import type { AdSchedule } from "@convex/lib/adBreaks";
import { parseAdSchedule } from "@convex/lib/adBreaks";
import { type AdBreakInputs, adBreakView, formatAgo, formatCountdown, runningAdFromBegin } from "./ad-break-view";

const NOW = Date.parse("2026-09-28T20:00:00Z");

function schedule(overrides: Partial<AdSchedule> = {}): AdSchedule {
  return {
    nextAdAt: "2026-09-28T20:05:00Z",
    lastAdAt: "2026-09-28T19:30:00Z",
    durationSeconds: 90,
    prerollFreeSeconds: 600,
    snoozeCount: 2,
    snoozeRefreshAt: "2026-09-28T20:30:00Z",
    ...overrides,
  };
}

function inputs(overrides: Partial<AdBreakInputs> = {}): AdBreakInputs {
  return {
    live: true,
    scopeGranted: true,
    fetch: { status: "ok", result: { state: "ok", schedule: schedule() }, fetchedAt: NOW },
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

  test("a missing scope wins over what the engine said", () => {
    expect(adBreakView(inputs({ scopeGranted: false }))).toEqual({ kind: "scopeMissing" });
  });

  test("engine states pass through", () => {
    const outdated = inputs({ fetch: { status: "ok", result: { state: "engineOutdated" }, fetchedAt: NOW } });
    expect(adBreakView(outdated)).toEqual({ kind: "engineOutdated" });
    const unregistered = inputs({ fetch: { status: "ok", result: { state: "unregistered" }, fetchedAt: NOW } });
    expect(adBreakView(unregistered)).toEqual({ kind: "unregistered" });
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
    const fetch = {
      status: "ok" as const,
      result: { state: "ok" as const, schedule: schedule({ nextAdAt: null, lastAdAt: null, snoozeRefreshAt: null }) },
      fetchedAt: NOW,
    };
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
    const fetch = {
      status: "ok" as const,
      result: { state: "ok" as const, schedule: schedule({ lastAdAt: "2026-09-28T19:59:00Z", durationSeconds: 90 }) },
      fetchedAt: NOW,
    };
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

describe("parseAdSchedule", () => {
  test("accepts the engine's shape", () => {
    expect(parseAdSchedule(schedule())).toEqual(schedule());
  });

  test("refuses a malformed answer whole", () => {
    expect(parseAdSchedule({ ...schedule(), nextAdAt: "soon" })).toBeNull();
    expect(parseAdSchedule({ ...schedule(), snoozeCount: -1 })).toBeNull();
    expect(parseAdSchedule({ ...schedule(), durationSeconds: undefined })).toBeNull();
    expect(parseAdSchedule("nope")).toBeNull();
  });
});
