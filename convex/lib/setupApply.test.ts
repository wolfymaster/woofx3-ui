import { describe, expect, test } from "bun:test";
import {
  nextApplyDelay,
  PACK_RETRY_DELAYS_MS,
  packStatusFromOutcomes,
  platformsToApply,
  seedsDefaults,
  settlePending,
} from "./setupApply";

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

describe("platformsToApply", () => {
  const obs = { marketplaceModuleId: "woofx3_obs", approvedPermissions: ["a"] };
  const twitch = { marketplaceModuleId: "woofx3_twitch", approvedPermissions: ["b"] };

  test("production applies what was chosen", () => {
    expect(platformsToApply([obs], false)).toEqual([obs]);
  });

  test("a preview that left Twitch out installs it anyway, approving what it asks for", () => {
    expect(platformsToApply([obs], true)).toEqual([
      obs,
      { marketplaceModuleId: "woofx3_twitch", approvedPermissions: [], approvedLocalEndpoints: [], implicit: true },
    ]);
  });

  test("a preview that chose Twitch keeps the choice", () => {
    expect(platformsToApply([twitch], true)).toEqual([twitch]);
  });
});

describe("settlePending", () => {
  test("turns what is still waiting into a failure, keeping its reason", () => {
    expect(settlePending({ status: "pending" as const, error: "no trigger" })).toEqual({
      status: "failed",
      error: "no trigger",
    });
    expect(settlePending({ status: "pending" as const }).error).toBe("Timed out waiting to install.");
  });

  test("leaves anything settled alone", () => {
    expect(settlePending({ status: "installed" as const })).toEqual({ status: "installed" });
  });
});

describe("seedsDefaults", () => {
  test("a setup not yet applied is seeded, and one already seeding keeps going", () => {
    expect(seedsDefaults({})).toBe(true);
    expect(seedsDefaults({ moduleInstalls: [], defaultSeed: {} })).toBe(true);
  });

  test("a setup applied before the seed existed is left alone", () => {
    expect(seedsDefaults({ moduleInstalls: [] })).toBe(false);
  });
});
