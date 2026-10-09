import { describe, expect, test } from "bun:test";
import {
  type AlertLifecyclePoint,
  compareEngineWrites,
  type EngineAlertStatus,
  isFailureStatus,
  mergeLifecycle,
  normaliseStatus,
  outcomeOf,
  parseEngineTimestamp,
  readAlertSnapshot,
  UNSETTLED_STATUSES,
} from "./engineAlertLifecycle";

const T0 = "2026-09-17T08:49:58.000Z";
const T1 = "2026-09-17T08:50:03.000Z";
const T2 = "2026-09-17T08:50:09.000Z";

/** A snapshot from an engine that sends no version. */
function at(status: EngineAlertStatus, engineUpdatedAt = T0): AlertLifecyclePoint {
  return { status, engineUpdatedAt };
}

/** A snapshot from an engine that versions its writes. */
function v(status: EngineAlertStatus, engineVersion: number, engineUpdatedAt = T0): AlertLifecyclePoint {
  return { status, engineVersion, engineUpdatedAt };
}

const VERDICTS = ["completed", "failed", "skipped", "timed_out"] as const;

/** Whether the engine lets verdict `second` replace verdict `first`. */
function engineReplaces(first: EngineAlertStatus, second: EngineAlertStatus): boolean {
  if (second === "completed") {
    return first !== "completed";
  }
  return first === "timed_out" && (second === "failed" || second === "skipped");
}

describe("compareEngineWrites", () => {
  test("compares versions when both snapshots carry one", () => {
    expect(compareEngineWrites(v("playing", 2, T1), v("playing", 3, T0))).toBe(1);
    expect(compareEngineWrites(v("playing", 3, T0), v("playing", 2, T1))).toBe(-1);
    expect(compareEngineWrites(v("playing", 2, T0), v("playing", 2, T1))).toBe(0);
  });

  test("compares timestamps otherwise, whatever their precision", () => {
    expect(compareEngineWrites(at("playing", T0), at("playing", T1))).toBe(1);
    expect(compareEngineWrites(v("playing", 4, T1), at("playing", T0))).toBe(-1);
    expect(
      compareEngineWrites(at("playing", "2026-09-17T08:50:03.120Z"), at("playing", "2026-09-17T08:50:03.12Z"))
    ).toBe(0);
  });

  // Engine rows carry microseconds; two writes in one millisecond must still
  // be told apart.
  test("orders timestamps below the millisecond", () => {
    expect(
      compareEngineWrites(at("playing", "2026-09-17T08:50:03.123400Z"), at("playing", "2026-09-17T08:50:03.123456789Z"))
    ).toBe(1);
  });

  test("cannot order a timestamp that does not parse", () => {
    expect(compareEngineWrites(at("playing", "a"), at("playing", T0))).toBeNull();
  });
});

describe("mergeLifecycle with versioned snapshots", () => {
  test("moves an alert forward through its lifecycle", () => {
    expect(mergeLifecycle(v("sent", 1), v("dispatched", 2)).kind).toBe("apply");
    expect(mergeLifecycle(v("dispatched", 2), v("playing", 3)).kind).toBe("apply");
    expect(mergeLifecycle(v("playing", 3), v("completed", 4)).kind).toBe("apply");
    expect(mergeLifecycle(v("sent", 1), v("failed", 5)).kind).toBe("apply");
  });

  test("applies the engine's verdict rule", () => {
    for (const first of VERDICTS) {
      for (const second of VERDICTS) {
        const merge = mergeLifecycle(v(first, 2), v(second, 3));
        expect([first, second, merge.kind]).toEqual([
          first,
          second,
          engineReplaces(first, second) ? "apply" : "diverged",
        ]);
      }
    }
  });

  // An alert fans out to two widgets; the queue is cleared while the second
  // plays it, then that widget finishes it.
  test("lets completed replace a skip from a queue clear", () => {
    const merge = mergeLifecycle({ ...v("skipped", 3) }, { ...v("completed", 4, T1), completedAt: T0 });
    expect(merge.kind).toBe("apply");
  });

  test("keeps an older write out silently, whatever its status", () => {
    expect(mergeLifecycle(v("completed", 4), v("sent", 1)).kind).toBe("keep");
    expect(mergeLifecycle(v("failed", 3), v("completed", 2)).kind).toBe("keep");
    expect(mergeLifecycle(v("playing", 3, T0), v("completed", 2, T1)).kind).toBe("keep");
  });

  test("orders by version even when the timestamps disagree", () => {
    expect(mergeLifecycle(v("timed_out", 4, T1), v("completed", 5, T0)).kind).toBe("apply");
  });

  test("reports a newer version the rule refuses as a divergence", () => {
    expect(mergeLifecycle(v("completed", 4), v("playing", 9)).kind).toBe("diverged");
    expect(mergeLifecycle(v("replayed", 3), v("completed", 4)).kind).toBe("diverged");
    expect(mergeLifecycle(v("replayed", 3), v("replayed", 4)).kind).toBe("diverged");
  });

  test("keeps a redelivery of the version held without changing anything", () => {
    const stored = { ...v("completed", 3, T1), playedAt: T0, completedAt: T1 };
    expect(mergeLifecycle(stored, { ...stored }).kind).toBe("keep");
    expect(mergeLifecycle({ ...stored, error: undefined }, { ...stored, error: "" }).kind).toBe("keep");
  });

  test("reports the same version with different contents as a divergence", () => {
    const stored = { ...v("completed", 3, T1), completedAt: T1 };
    expect(mergeLifecycle(stored, { ...stored, status: "failed", error: "x" }).kind).toBe("diverged");
    expect(mergeLifecycle(stored, { ...stored, completedAt: T2 }).kind).toBe("diverged");
  });

  test("counts only a status change or a later write as progress", () => {
    const merge = mergeLifecycle(v("playing", 2), v("completed", 3, T1));
    expect(merge.kind === "apply" && merge.progressed).toBe(true);
  });

  // Only `alert.recorded` can carry a status this build does not know, so it
  // is the alert's starting point, not an ending.
  test("treats an unknown status as a starting point", () => {
    expect(mergeLifecycle(v("unknown", 1), v("dispatched", 2)).kind).toBe("apply");
    expect(mergeLifecycle(v("unknown", 1), v("completed", 3)).kind).toBe("apply");
    expect(mergeLifecycle(v("playing", 3), v("unknown", 1)).kind).toBe("keep");
  });
});

describe("mergeLifecycle with a versioned snapshot and an unversioned row", () => {
  test("orders by timestamp and applies the engine's rule", () => {
    expect(mergeLifecycle(at("playing", T0), v("completed", 4, T1)).kind).toBe("apply");
    expect(mergeLifecycle(at("completed", T1), v("timed_out", 9, T0)).kind).toBe("keep");
    expect(mergeLifecycle(at("completed", T0), v("failed", 5, T1)).kind).toBe("diverged");
  });

  test("adopts the version of the write the row already holds, without counting progress", () => {
    const merge = mergeLifecycle(at("playing", T0), v("playing", 3, T0));
    expect(merge.kind).toBe("apply");
    expect(merge.kind === "apply" && merge.merged.engineVersion).toBe(3);
    expect(merge.kind === "apply" && merge.progressed).toBe(false);
  });

  test("lets the rule decide when the timestamps cannot be ordered", () => {
    expect(mergeLifecycle(at("timed_out", "not a time"), v("completed", 2, T0)).kind).toBe("apply");
    expect(mergeLifecycle(at("completed", "not a time"), v("timed_out", 2, T1)).kind).toBe("keep");
  });
});

describe("mergeLifecycle with unversioned snapshots", () => {
  test("moves an alert forward and keeps it from moving back", () => {
    expect(mergeLifecycle(at("sent"), at("playing", T1)).kind).toBe("apply");
    expect(mergeLifecycle(at("completed", T1), at("sent")).kind).toBe("keep");
    expect(mergeLifecycle(at("failed", T1), at("playing")).kind).toBe("keep");
  });

  // An engine that predates versions let a later verdict correct an earlier
  // one; its corrections must still land.
  test("lets a later verdict replace an earlier one, last write wins", () => {
    for (const first of VERDICTS) {
      for (const second of VERDICTS) {
        expect(mergeLifecycle(at(first, T0), at(second, T1)).kind).toBe("apply");
        if (first !== second) {
          expect(mergeLifecycle(at(first, T1), at(second, T0)).kind).toBe("keep");
        }
      }
    }
  });

  test("reports a newer snapshot that would move the row back as a divergence", () => {
    expect(mergeLifecycle(at("completed", T0), at("playing", T1)).kind).toBe("diverged");
  });

  test("accepts a redelivered callback without counting progress", () => {
    const merge = mergeLifecycle(at("playing", T0), at("playing", T0));
    expect(merge.kind === "apply" && merge.progressed).toBe(false);
  });

  test("counts a status change or a later write as progress", () => {
    const later = mergeLifecycle(at("sent", T0), at("sent", T1));
    expect(later.kind === "apply" && later.progressed).toBe(true);
    const moved = mergeLifecycle(at("sent", T0), at("playing", T0));
    expect(moved.kind === "apply" && moved.progressed).toBe(true);
    const unordered = mergeLifecycle(at("playing", "a"), at("playing", "b"));
    expect(unordered.kind === "apply" && unordered.progressed).toBe(true);
  });

  test("drops the row's version, which no longer describes what it holds", () => {
    const merge = mergeLifecycle(v("playing", 3, T0), at("completed", T1));
    expect(merge.kind).toBe("apply");
    expect(merge.kind === "apply" && "engineVersion" in merge.merged && merge.merged.engineVersion).toBeUndefined();
  });

  // A versioned write stored, then corrected by an unversioned snapshot: a
  // redelivery of the old version must not bring the old data back.
  test("keeps a later redelivery of the dropped version out", () => {
    const original = { ...v("completed", 2, T1), playedAt: T0 };
    const corrected = mergeLifecycle(original, { ...at("completed", T2), playedAt: T1 });
    if (corrected.kind !== "apply") {
      throw new Error("the correction was refused");
    }
    expect(mergeLifecycle(corrected.merged, original).kind).toBe("keep");
  });
});

describe("parseEngineTimestamp", () => {
  test("keeps every fractional digit", () => {
    expect(parseEngineTimestamp("1970-01-01T00:00:01.000000001Z")).toBe(1_000_000_001n);
    expect(parseEngineTimestamp("1970-01-01T00:00:00.5Z")).toBe(500_000_000n);
    expect(parseEngineTimestamp("1970-01-01T00:00:00Z")).toBe(0n);
  });

  test("applies the UTC offset", () => {
    expect(parseEngineTimestamp("1970-01-01T01:00:00+01:00")).toBe(0n);
    expect(parseEngineTimestamp("1969-12-31T23:30:00-00:30")).toBe(0n);
  });

  test("refuses what is not an RFC 3339 timestamp", () => {
    expect(parseEngineTimestamp("not a time")).toBeNull();
    expect(parseEngineTimestamp("2026-09-17 08:50:03Z")).toBeNull();
    expect(parseEngineTimestamp("2026-13-17T08:50:03Z")).toBeNull();
    expect(parseEngineTimestamp("2026-09-17T08:50:03.1234567890Z")).toBeNull();
  });
});

describe("normaliseStatus", () => {
  test("keeps a status this build knows", () => {
    expect(normaliseStatus("timed_out")).toBe("timed_out");
  });

  test("stores a status from a newer engine as unknown", () => {
    expect(normaliseStatus("cancelled")).toBe("unknown");
  });
});

describe("outcomeOf", () => {
  test("counts an unsettled alert as in flight until the sweep marks it", () => {
    for (const status of UNSETTLED_STATUSES) {
      expect(outcomeOf({ status })).toBe("inFlight");
      expect(outcomeOf({ status, unconfirmedAt: 1 })).toBe("unconfirmed");
    }
  });

  test("counts a settled alert by its verdict, mark or not", () => {
    expect(outcomeOf({ status: "completed", unconfirmedAt: 1 })).toBe("completed");
    expect(outcomeOf({ status: "timed_out" })).toBe("failed");
    expect(outcomeOf({ status: "skipped" })).toBe("skipped");
    expect(outcomeOf({ status: "replayed" })).toBe("replayed");
  });
});

describe("readAlertSnapshot", () => {
  const snapshot = {
    id: "a1",
    payload: "{}",
    status: "playing",
    createdAt: T0,
    updatedAt: T1,
    playedAt: T1,
  };

  test("reads a snapshot and keeps only the fields it knows", () => {
    expect(readAlertSnapshot({ ...snapshot, addedLater: "x" })).toEqual({ snapshot, problems: [] });
  });

  test("copies the version", () => {
    expect(readAlertSnapshot({ ...snapshot, version: 3 }).snapshot).toEqual({ ...snapshot, version: 3 });
  });

  test("reads a version that is not a positive integer as absent, and reports it", () => {
    for (const version of [0, -1, 1.5, "3", Number.NaN, null]) {
      const reading = readAlertSnapshot({ ...snapshot, version });
      expect(reading.snapshot).toEqual(snapshot);
      expect(reading.problems).toHaveLength(1);
    }
  });

  test("reads a null or mistyped optional field as absent, and reports it", () => {
    const reading = readAlertSnapshot({ ...snapshot, error: null, playedAt: 5 });
    const { playedAt: _playedAt, ...withoutPlayedAt } = snapshot;
    expect(reading.snapshot).toEqual(withoutPlayedAt);
    expect(reading.problems).toHaveLength(2);
  });

  test("defaults a missing payload and timestamps, and reports them", () => {
    const reading = readAlertSnapshot({ id: "a1", status: "playing" });
    expect(reading.snapshot).toEqual({ id: "a1", status: "playing", payload: "", updatedAt: "", createdAt: "" });
    expect(reading.problems).toHaveLength(3);
    const { createdAt: _createdAt, ...withoutCreatedAt } = snapshot;
    expect(readAlertSnapshot(withoutCreatedAt).snapshot?.createdAt).toBe(T1);
  });

  test("refuses a snapshot without an id or a status", () => {
    expect(readAlertSnapshot({ ...snapshot, id: undefined }).snapshot).toBeNull();
    expect(readAlertSnapshot({ ...snapshot, id: "" }).snapshot).toBeNull();
    expect(readAlertSnapshot({ ...snapshot, status: 3 }).problems).toEqual(["status is malformed (3)"]);
    expect(readAlertSnapshot(null).snapshot).toBeNull();
    expect(readAlertSnapshot("alert").snapshot).toBeNull();
  });
});

describe("isFailureStatus", () => {
  test("counts a timeout as a failure, as the overview does", () => {
    expect(isFailureStatus("failed")).toBe(true);
    expect(isFailureStatus("timed_out")).toBe(true);
  });

  // A skip is an operator's decision and a replay supersedes its row; neither
  // is the overlay failing to play something.
  test("does not count a skip, a replay or an unknown status as a failure", () => {
    expect(isFailureStatus("skipped")).toBe(false);
    expect(isFailureStatus("replayed")).toBe(false);
    expect(isFailureStatus("playing")).toBe(false);
    expect(isFailureStatus("unknown")).toBe(false);
    expect(isFailureStatus("teleported")).toBe(false);
  });
});
