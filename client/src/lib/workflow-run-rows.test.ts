import { describe, expect, test } from "bun:test";
import { canReplayRun, isActiveRun, runDurationMs, runOriginLabel } from "@/lib/workflow-run-rows";

describe("runOriginLabel", () => {
  test("names the dashboard's own origins", () => {
    expect(runOriginLabel("test")).toBe("Test run");
    expect(runOriginLabel("replay")).toBe("Replay");
    expect(runOriginLabel("dashboard")).toBe("Dashboard");
  });

  test("calls a run with no origin an event, and shows any other origin as sent", () => {
    expect(runOriginLabel(undefined)).toBe("Event");
    expect(runOriginLabel("")).toBe("Event");
    expect(runOriginLabel("twitch")).toBe("twitch");
  });
});

describe("isActiveRun / canReplayRun", () => {
  test("a running or waiting run is active and cannot be replayed", () => {
    expect(isActiveRun({ status: "running" })).toBe(true);
    expect(isActiveRun({ status: "waiting" })).toBe(true);
    expect(canReplayRun({ status: "running", hasTriggerEvent: true })).toBe(false);
  });

  test("a settled run with a recorded trigger event can be replayed", () => {
    expect(isActiveRun({ status: "failed" })).toBe(false);
    expect(canReplayRun({ status: "failed", hasTriggerEvent: true })).toBe(true);
  });

  test("a run with no trigger event has nothing to replay", () => {
    expect(canReplayRun({ status: "completed", hasTriggerEvent: false })).toBe(false);
  });
});

describe("runDurationMs", () => {
  const startedAt = "2026-09-28T12:00:00.000000000Z";
  const started = Date.parse("2026-09-28T12:00:00.000Z");

  test("measures a settled run to its completion", () => {
    expect(runDurationMs({ status: "completed", startedAt, completedAt: "2026-09-28T12:00:02.500Z" }, 0)).toBe(2500);
  });

  test("measures a running run to now", () => {
    expect(runDurationMs({ status: "running", startedAt }, started + 4000)).toBe(4000);
  });

  test("is undefined without readable, ordered timestamps", () => {
    expect(runDurationMs({ status: "completed" }, 0)).toBeUndefined();
    expect(runDurationMs({ status: "completed", startedAt }, 0)).toBeUndefined();
    expect(runDurationMs({ status: "completed", startedAt, completedAt: "2026-09-28T11:00:00Z" }, 0)).toBeUndefined();
  });
});
