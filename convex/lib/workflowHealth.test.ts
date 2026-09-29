import { describe, expect, it } from "bun:test";
import {
  compareSince,
  HEALTH_STILL_LOADING_MESSAGE,
  isStillLoadingError,
  MAX_REASON_LENGTH,
  type ParsedWorkflowHealth,
  parseWorkflowHealthChanged,
  parseWorkflowHealthList,
  parseWorkflowHealthSnapshot,
  planHealthWrite,
  planResync,
  planSnapshot,
  RESYNC_MIN_INTERVAL_MS,
  type StoredHealthRow,
  shouldResync,
  subMillisecondNanos,
  WORKFLOW_HEALTH_CHANGED_EVENT_TYPE,
  WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE,
} from "./workflowHealth";

const T0 = "2026-09-28T10:00:00.000Z";
const T0_MS = Date.parse(T0);

function event(overrides: Record<string, unknown> = {}) {
  return {
    type: WORKFLOW_HEALTH_CHANGED_EVENT_TYPE,
    workflowId: "wf-1",
    status: "error",
    reason: "steps[0].action: unknown action send_chat",
    since: T0,
    ...overrides,
  };
}

function parsed(overrides: Partial<ParsedWorkflowHealth> = {}): ParsedWorkflowHealth {
  const since = overrides.since ?? T0;
  return {
    engineWorkflowId: "wf-1",
    status: "error",
    reason: "broken",
    since,
    sinceMs: Date.parse(since),
    ...overrides,
  };
}

function row(overrides: Partial<StoredHealthRow> = {}): StoredHealthRow {
  return {
    engineWorkflowId: "wf-1",
    status: "error",
    reason: "broken",
    sinceMs: T0_MS,
    receivedAt: 1_000,
    ...overrides,
  };
}

describe("parseWorkflowHealthChanged", () => {
  it("accepts an error event", () => {
    const result = parseWorkflowHealthChanged(event());
    expect(result).toEqual({
      ok: true,
      health: {
        engineWorkflowId: "wf-1",
        status: "error",
        reason: "steps[0].action: unknown action send_chat",
        since: T0,
        sinceMs: T0_MS,
      },
    });
  });

  it("drops a reason on an ok event", () => {
    const result = parseWorkflowHealthChanged(event({ status: "ok", reason: "leftover" }));
    expect(result.ok && result.health.reason).toBeUndefined();
  });

  it("accepts an error with no reason", () => {
    const result = parseWorkflowHealthChanged(event({ reason: undefined }));
    expect(result.ok && result.health.reason).toBeUndefined();
  });

  it("truncates a very long reason", () => {
    const result = parseWorkflowHealthChanged(event({ reason: "x".repeat(MAX_REASON_LENGTH + 50) }));
    expect(result.ok && result.health.reason?.length).toBe(MAX_REASON_LENGTH);
  });

  it("rejects the wrong type, a missing id, an unknown status and a bad timestamp", () => {
    expect(parseWorkflowHealthChanged(event({ type: "workflow.created" })).ok).toBe(false);
    expect(parseWorkflowHealthChanged(event({ workflowId: "" })).ok).toBe(false);
    expect(parseWorkflowHealthChanged(event({ status: "degraded" })).ok).toBe(false);
    expect(parseWorkflowHealthChanged(event({ since: "yesterday" })).ok).toBe(false);
    expect(parseWorkflowHealthChanged(event({ reason: 42 })).ok).toBe(false);
    expect(parseWorkflowHealthChanged(null).ok).toBe(false);
  });
});

describe("parseWorkflowHealthList", () => {
  it("parses every entry", () => {
    const result = parseWorkflowHealthList([
      { workflowId: "a", status: "ok", since: T0 },
      { workflowId: "b", status: "error", reason: "bad", since: T0 },
    ]);
    expect(result.ok && result.entries.map((e) => e.engineWorkflowId)).toEqual(["a", "b"]);
  });

  it("rejects the whole list when one entry is malformed", () => {
    const result = parseWorkflowHealthList([{ workflowId: "a", status: "ok", since: T0 }, { workflowId: "b" }]);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-array", () => {
    expect(parseWorkflowHealthList({ workflows: [] }).ok).toBe(false);
  });
});

describe("parseWorkflowHealthSnapshot", () => {
  it("accepts an empty snapshot", () => {
    const result = parseWorkflowHealthSnapshot({ type: WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE, workflows: [], at: T0 });
    expect(result).toEqual({ ok: true, snapshot: { entries: [], at: T0, atMs: T0_MS } });
  });

  it("parses the listed errors", () => {
    const result = parseWorkflowHealthSnapshot({
      type: WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE,
      workflows: [{ workflowId: "a", status: "error", reason: "bad", since: T0 }],
      at: T0,
    });
    expect(result.ok && result.snapshot.entries.map((e) => e.reason)).toEqual(["bad"]);
  });

  it("rejects a missing at, a malformed entry and the wrong type", () => {
    expect(parseWorkflowHealthSnapshot({ type: WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE, workflows: [] }).ok).toBe(false);
    expect(parseWorkflowHealthSnapshot({ type: WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE, workflows: [{}], at: T0 }).ok).toBe(
      false
    );
    expect(parseWorkflowHealthSnapshot({ type: WORKFLOW_HEALTH_CHANGED_EVENT_TYPE, workflows: [], at: T0 }).ok).toBe(
      false
    );
  });
});

describe("planHealthWrite", () => {
  it("inserts when nothing is stored", () => {
    expect(planHealthWrite(null, parsed())).toBe("insert");
  });

  it("ignores an older report", () => {
    expect(planHealthWrite(row({ sinceMs: T0_MS + 1 }), parsed())).toBe("stale");
  });

  it("reports a repeat as unchanged", () => {
    expect(planHealthWrite(row(), parsed())).toBe("unchanged");
  });

  it("replaces on a newer report", () => {
    expect(planHealthWrite(row(), parsed({ status: "ok", reason: undefined, since: "2026-09-28T10:05:00.000Z" }))).toBe(
      "replace"
    );
  });

  it("replaces on a changed reason at the same instant", () => {
    expect(planHealthWrite(row(), parsed({ reason: "different" }))).toBe("replace");
  });
});

describe("planResync", () => {
  const fetchStartedAt = 5_000;

  it("writes new and changed entries and skips repeats", () => {
    const later = "2026-09-28T11:00:00.000Z";
    const plan = planResync(
      [row({ engineWorkflowId: "same" }), row({ engineWorkflowId: "changed" })],
      [
        parsed({ engineWorkflowId: "same" }),
        parsed({ engineWorkflowId: "changed", status: "ok", reason: undefined, since: later }),
        parsed({ engineWorkflowId: "new" }),
      ],
      fetchStartedAt
    );
    expect(plan.writes.map((w) => w.engineWorkflowId)).toEqual(["changed", "new"]);
    expect(plan.clears).toEqual([]);
  });

  it("clears an error the engine no longer lists, just past its since", () => {
    const plan = planResync([row({ engineWorkflowId: "gone" })], [], fetchStartedAt);
    expect(plan.clears).toEqual([
      {
        engineWorkflowId: "gone",
        status: "ok",
        reason: undefined,
        since: new Date(T0_MS + 1).toISOString(),
        sinceMs: T0_MS + 1,
      },
    ]);
    // The same error redelivered afterwards loses to the clear.
    expect(planHealthWrite({ status: "ok", sinceMs: plan.clears[0].sinceMs }, parsed())).toBe("stale");
  });

  it("keeps an error written while the snapshot was being fetched", () => {
    const plan = planResync([row({ receivedAt: fetchStartedAt })], [], fetchStartedAt);
    expect(plan.clears).toEqual([]);
  });

  it("leaves unlisted ok rows alone", () => {
    const plan = planResync([row({ status: "ok", reason: undefined })], [], fetchStartedAt);
    expect(plan).toEqual({ writes: [], clears: [] });
  });

  it("does not let a stale snapshot entry overwrite a newer webhook", () => {
    const plan = planResync([row({ status: "ok", reason: undefined, sinceMs: T0_MS + 60_000 })], [parsed()], 0);
    expect(plan.writes).toEqual([]);
  });
});

describe("sub-millisecond ordering", () => {
  it("parses Go's trimmed nanosecond fractions as numbers", () => {
    expect(subMillisecondNanos("2026-09-28T10:00:00.000000001Z")).toBe(1);
    expect(subMillisecondNanos("2026-09-28T10:00:00.1234567Z")).toBe(456_700);
    expect(subMillisecondNanos("2026-09-28T10:00:00.12345Z")).toBe(450_000);
    expect(subMillisecondNanos("2026-09-28T10:00:00.123Z")).toBe(0);
    expect(subMillisecondNanos("2026-09-28T10:00:00Z")).toBe(0);
    expect(subMillisecondNanos(undefined)).toBe(0);
  });

  it("orders within one millisecond where text comparison would not", () => {
    // ".00000005" < ".0000001" as numbers, but not as strings.
    const earlier = parsed({ since: "2026-09-28T10:00:00.00000005Z" });
    const later = parsed({ since: "2026-09-28T10:00:00.0000001Z" });
    expect(earlier.sinceMs).toBe(later.sinceMs);
    expect(compareSince(earlier, later)).toBeLessThan(0);
    expect(compareSince(later, earlier)).toBeGreaterThan(0);
  });

  it("treats an older report in the same millisecond as stale", () => {
    const stored = { status: "ok" as const, sinceMs: T0_MS, since: "2026-09-28T10:00:00.000500Z" };
    expect(planHealthWrite(stored, parsed({ since: "2026-09-28T10:00:00.0004Z" }))).toBe("stale");
    expect(planHealthWrite(stored, parsed({ since: "2026-09-28T10:00:00.0006Z" }))).toBe("replace");
  });

  it("keeps an error that began after a snapshot within the same millisecond", () => {
    const at = "2026-09-28T10:00:00.0001Z";
    const plan = planSnapshot([row({ since: "2026-09-28T10:00:00.0002Z" })], { entries: [], at, atMs: T0_MS });
    expect(plan.clears).toEqual([]);
  });
});

describe("planSnapshot", () => {
  const at = "2026-09-28T12:00:00.000Z";
  const atMs = Date.parse(at);

  it("clears every error the snapshot does not list, as of at", () => {
    const plan = planSnapshot([row({ engineWorkflowId: "fixed" })], { entries: [], at, atMs });
    expect(plan.writes).toEqual([]);
    expect(plan.clears).toEqual([
      { engineWorkflowId: "fixed", status: "ok", reason: undefined, since: at, sinceMs: atMs },
    ]);
    expect(planHealthWrite({ status: "ok", sinceMs: atMs }, parsed())).toBe("stale");
  });

  it("clears an error that began at the same instant as the snapshot past its since", () => {
    const plan = planSnapshot([row({ sinceMs: atMs })], { entries: [], at, atMs });
    expect(plan.clears[0].sinceMs).toBe(atMs + 1);
  });

  it("keeps an error that began after the snapshot was taken", () => {
    const plan = planSnapshot([row({ sinceMs: atMs + 5 })], { entries: [], at, atMs });
    expect(plan.clears).toEqual([]);
  });

  it("writes listed errors and leaves ok rows alone", () => {
    const plan = planSnapshot([row({ engineWorkflowId: "ok-one", status: "ok", reason: undefined })], {
      entries: [parsed({ engineWorkflowId: "broken" })],
      at,
      atMs,
    });
    expect(plan.writes.map((w) => w.engineWorkflowId)).toEqual(["broken"]);
    expect(plan.clears).toEqual([]);
  });

  it("does not roll back a newer change with an older listed entry", () => {
    const plan = planSnapshot([row({ status: "ok", reason: undefined, sinceMs: atMs + 10 })], {
      entries: [parsed()],
      at,
      atMs,
    });
    expect(plan.writes).toEqual([]);
  });
});

describe("shouldResync", () => {
  it("runs the first time", () => {
    expect(shouldResync(null, 0, "mount")).toBe(true);
  });

  it("spaces mounts further apart than reconnects", () => {
    const last = 1_000_000;
    const between = last + RESYNC_MIN_INTERVAL_MS.reconnect;
    expect(shouldResync(last, between, "reconnect")).toBe(true);
    expect(shouldResync(last, between, "mount")).toBe(false);
    expect(shouldResync(last, last + RESYNC_MIN_INTERVAL_MS.mount, "mount")).toBe(true);
  });
});

describe("isStillLoadingError", () => {
  it("recognises the engine's still-loading refusal", () => {
    expect(isStillLoadingError(new Error(HEALTH_STILL_LOADING_MESSAGE))).toBe(true);
    expect(isStillLoadingError(new Error("fetch failed"))).toBe(false);
    expect(isStillLoadingError(new TypeError("'getWorkflowHealth' is not a function."))).toBe(false);
  });
});
