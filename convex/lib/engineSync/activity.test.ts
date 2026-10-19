import { describe, expect, test } from "bun:test";
import { ENGINE_ACTIVITY_WRITE_INTERVAL_MS, engineActivityPatch, isEngineActive } from "./activity";
import { ENGINE_SYNC_CONFIG } from "./config";

const NOW = 1_800_000_000_000;

describe("engine activity and the sync sweep", () => {
  test("an instance the engine has just called back is synced by the sweep", () => {
    const callbackAt = NOW - 10 * 60 * 1000;
    const patch = engineActivityPatch(undefined, callbackAt);
    expect(patch).toEqual({ lastEngineActivityAt: callbackAt });
    expect(isEngineActive(patch?.lastEngineActivityAt, NOW)).toBe(true);
  });

  test("an instance whose engine has never called back is not synced on a schedule", () => {
    expect(isEngineActive(undefined, NOW)).toBe(false);
  });

  test("an engine silent for longer than the inactivity window is not synced", () => {
    const lastCallback = NOW - ENGINE_SYNC_CONFIG.inactivityThresholdMs - 1;
    expect(isEngineActive(lastCallback, NOW)).toBe(false);
  });

  test("a callback within the write interval of the last recorded one writes nothing", () => {
    const recorded = NOW - ENGINE_ACTIVITY_WRITE_INTERVAL_MS + 1;
    expect(engineActivityPatch(recorded, NOW)).toBeNull();
  });

  test("a callback once the write interval has passed records the new time", () => {
    const recorded = NOW - ENGINE_ACTIVITY_WRITE_INTERVAL_MS;
    expect(engineActivityPatch(recorded, NOW)).toEqual({ lastEngineActivityAt: NOW });
  });

  test("the write interval leaves an active engine inside the inactivity window", () => {
    expect(ENGINE_ACTIVITY_WRITE_INTERVAL_MS).toBeLessThan(ENGINE_SYNC_CONFIG.inactivityThresholdMs);
  });
});
