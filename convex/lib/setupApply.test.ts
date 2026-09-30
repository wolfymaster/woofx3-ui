import { describe, expect, test } from "bun:test";
import { nextApplyDelay, PACK_RETRY_DELAYS_MS, packStatusFromOutcomes } from "./setupApply";

describe("packStatusFromOutcomes", () => {
  test("is installed when every item is in place", () => {
    expect(packStatusFromOutcomes([{ outcome: "installed" }, { outcome: "already-installed" }])).toEqual({
      status: "installed",
    });
  });

  test("counts a command name the streamer already uses as in place", () => {
    expect(packStatusFromOutcomes([{ outcome: "installed" }, { outcome: "conflict" }])).toEqual({
      status: "installed",
    });
  });

  test("is pending while an item waits, keeping the reason", () => {
    expect(
      packStatusFromOutcomes([{ outcome: "installed" }, { outcome: "unavailable", message: "Needs the Twitch module" }])
    ).toEqual({ status: "pending", error: "Needs the Twitch module" });
    expect(packStatusFromOutcomes([{ outcome: "busy" }])).toEqual({ status: "pending" });
  });

  test("is failed when any item failed, even if another is waiting", () => {
    expect(packStatusFromOutcomes([{ outcome: "pending" }, { outcome: "failed", message: "engine said no" }])).toEqual({
      status: "failed",
      error: "engine said no",
    });
  });
});

describe("nextApplyDelay", () => {
  test("backs off after each run, then stops", () => {
    expect(nextApplyDelay(1)).toBe(PACK_RETRY_DELAYS_MS[0]);
    expect(nextApplyDelay(PACK_RETRY_DELAYS_MS.length)).toBe(PACK_RETRY_DELAYS_MS[PACK_RETRY_DELAYS_MS.length - 1]);
    expect(nextApplyDelay(PACK_RETRY_DELAYS_MS.length + 1)).toBeNull();
  });
});
