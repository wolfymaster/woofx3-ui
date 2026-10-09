import { describe, expect, test } from "bun:test";
import {
  type AlertLifecyclePoint,
  type EngineAlertMirror,
  type EngineAlertSnapshot,
  type EngineAlertStatus,
  isFailureStatus,
  mergeLifecycle,
  mirrorOf,
  normaliseStatus,
  outcomeOf,
  parseEngineTimestamp,
  readAlertSnapshot,
  UNSETTLED_STATUSES,
  updateMirror,
} from "./engineAlertLifecycle";

const T0 = "2026-09-17T08:49:58.000Z";
const T1 = "2026-09-17T08:50:03.000Z";
const T2 = "2026-09-17T08:50:09.000Z";

/** A snapshot without a version. */
function at(status: EngineAlertStatus, engineUpdatedAt = T0): AlertLifecyclePoint {
  return { status, engineUpdatedAt };
}

/** A snapshot with neither a version nor a usable timestamp. */
function untimed(status: EngineAlertStatus): AlertLifecyclePoint {
  return { status };
}

/** A snapshot with a version. */
function v(status: EngineAlertStatus, engineVersion: number, engineUpdatedAt = T0): AlertLifecyclePoint {
  return { status, engineVersion, engineUpdatedAt };
}

const STATUSES: EngineAlertStatus[] = [
  "pending",
  "sent",
  "unknown",
  "dispatched",
  "playing",
  "completed",
  "failed",
  "timed_out",
  "skipped",
  "replayed",
];
const VERDICTS = ["completed", "failed", "skipped", "timed_out"] as const;

describe("mergeLifecycle with versioned snapshots", () => {
  // The engine alone decides which transitions apply, so any status pair is
  // taken in version order, including ones its rule would refuse.
  test("applies a higher version whatever the statuses", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(mergeLifecycle(v(from, 2), v(to, 3))).toEqual({ kind: "apply", progressed: true });
      }
    }
  });

  test("keeps a lower version out silently, whatever its status", () => {
    for (const to of STATUSES) {
      expect(mergeLifecycle(v("completed", 4), v(to, 3)).kind).toBe("keep");
    }
  });

  test("orders by version even when the timestamps disagree", () => {
    expect(mergeLifecycle(v("playing", 2, T2), v("completed", 3, T0)).kind).toBe("apply");
    expect(mergeLifecycle(v("completed", 3, T0), v("playing", 2, T2)).kind).toBe("keep");
  });

  test("treats an equal version as a redelivery", () => {
    expect(mergeLifecycle(v("playing", 3, T1), v("playing", 3, T1)).kind).toBe("keep");
    expect(mergeLifecycle(v("playing", 3, T1), v("playing", 3, "2026-09-17T08:50:03Z")).kind).toBe("keep");
  });

  test("reports an equal version with a different status as a divergence", () => {
    expect(mergeLifecycle(v("playing", 3), v("failed", 3)).kind).toBe("diverged");
  });
});

describe("mergeLifecycle with unversioned snapshots", () => {
  test("moves an alert forward and keeps it from moving back", () => {
    expect(mergeLifecycle(at("sent", T0), at("playing", T1)).kind).toBe("apply");
    expect(mergeLifecycle(at("playing", T1), at("completed", T2)).kind).toBe("apply");
    expect(mergeLifecycle(at("completed", T1), at("playing", T2)).kind).toBe("keep");
    expect(mergeLifecycle(at("replayed", T1), at("completed", T2)).kind).toBe("keep");
  });

  test("keeps a later stage out when its timestamp is older", () => {
    expect(mergeLifecycle(at("playing", T2), at("completed", T1)).kind).toBe("keep");
  });

  test("lets a newer verdict replace an earlier one, and keeps an older one out", () => {
    for (const first of VERDICTS) {
      for (const second of VERDICTS) {
        expect(mergeLifecycle(at(first, T1), at(second, T2)).kind).toBe("apply");
        expect(mergeLifecycle(at(first, T2), at(second, T1)).kind).toBe("keep");
      }
    }
  });

  test("keeps a redelivery out, whatever the timestamp's precision", () => {
    expect(mergeLifecycle(at("completed", T1), at("completed", T1)).kind).toBe("keep");
    expect(
      mergeLifecycle(at("playing", "2026-09-17T08:50:03.120Z"), at("playing", "2026-09-17T08:50:03.12Z")).kind
    ).toBe("keep");
  });

  // Engine rows carry microseconds; two writes in one millisecond must still
  // be told apart.
  test("orders timestamps below the millisecond", () => {
    expect(
      mergeLifecycle(at("failed", "2026-09-17T08:50:03.123400Z"), at("completed", "2026-09-17T08:50:03.1234567Z")).kind
    ).toBe("apply");
  });

  test("orders by stage alone, and never replaces a verdict, when a timestamp is missing", () => {
    expect(mergeLifecycle(untimed("sent"), untimed("completed")).kind).toBe("apply");
    expect(mergeLifecycle(at("playing", T2), untimed("completed")).kind).toBe("apply");
    expect(mergeLifecycle(untimed("completed"), at("playing", T2)).kind).toBe("keep");
    for (const first of VERDICTS) {
      for (const second of VERDICTS) {
        expect(mergeLifecycle(at(first, T1), untimed(second)).kind).toBe("keep");
        expect(mergeLifecycle(untimed(first), at(second, T1)).kind).toBe("keep");
      }
    }
  });
});

describe("mergeLifecycle across versioned and unversioned snapshots", () => {
  test("lets an unversioned snapshot replace a versioned row only when it is newer", () => {
    expect(mergeLifecycle(v("playing", 3, T1), at("completed", T2)).kind).toBe("apply");
    expect(mergeLifecycle(v("failed", 3, T1), at("completed", T2)).kind).toBe("apply");
    expect(mergeLifecycle(v("playing", 3, T1), at("completed", T1)).kind).toBe("keep");
    expect(mergeLifecycle(v("playing", 3, T2), at("completed", T1)).kind).toBe("keep");
    expect(mergeLifecycle(v("completed", 3, T1), at("playing", T2)).kind).toBe("keep");
  });

  test("keeps an unversioned snapshot without a usable timestamp off a versioned row", () => {
    expect(mergeLifecycle(v("playing", 3, T1), untimed("completed")).kind).toBe("keep");
    expect(mergeLifecycle(v("sent", 1, T1), at("playing", "not a time")).kind).toBe("keep");
  });

  test("orders a versioned snapshot against an unversioned row by stage and timestamp", () => {
    expect(mergeLifecycle(at("playing", T1), v("completed", 4, T2)).kind).toBe("apply");
    expect(mergeLifecycle(at("completed", T2), v("failed", 4, T1)).kind).toBe("keep");
  });

  test("adopts the version of the write the row already holds, without counting progress", () => {
    expect(mergeLifecycle(at("playing", T1), v("playing", 3, T1))).toEqual({ kind: "apply", progressed: false });
  });

  // Nothing can be ordered after an unversioned row without a usable
  // timestamp, so a versioned snapshot is what lets it move within its stage.
  test("lets a versioned snapshot correct or version an unversioned row without a usable timestamp", () => {
    expect(mergeLifecycle(untimed("failed"), v("completed", 4, T2))).toEqual(PROGRESS);
    expect(mergeLifecycle(untimed("failed"), { status: "completed", engineVersion: 4 })).toEqual(PROGRESS);
    expect(mergeLifecycle(at("failed", "not a time"), v("completed", 4, T2))).toEqual(PROGRESS);
    expect(mergeLifecycle(untimed("completed"), v("completed", 4, T2))).toEqual({ kind: "apply", progressed: false });
    expect(mergeLifecycle(untimed("completed"), v("playing", 3, T2)).kind).toBe("keep");
  });

  test("keeps a same-stage versioned snapshot without a usable timestamp off a timed unversioned row", () => {
    expect(mergeLifecycle(at("failed", T1), { status: "completed", engineVersion: 4 }).kind).toBe("keep");
  });
});

const PROGRESS = { kind: "apply", progressed: true };

function snap(fields: Partial<EngineAlertSnapshot> & { status: string }): EngineAlertSnapshot {
  return { id: "a1", ...fields };
}

const ROW: EngineAlertMirror = {
  status: "failed",
  payload: '{"id":"e1"}',
  workflowId: "wf1",
  envelopeId: "e1",
  dispatchedAt: T0,
  playedAt: T1,
  completedAt: T1,
  error: "missing media",
  engineVersion: 3,
  engineCreatedAt: T0,
  engineUpdatedAt: T1,
};

describe("updateMirror", () => {
  test("replaces the lifecycle of a newer write", () => {
    const update = updateMirror(
      ROW,
      snap({ status: "completed", version: 4, updatedAt: T2, dispatchedAt: T0, playedAt: T1, completedAt: T1 })
    );
    expect(update.progressed).toBe(true);
    expect(update.patch).toEqual({
      status: "completed",
      engineStatus: undefined,
      engineVersion: 4,
      engineUpdatedAt: T2,
      dispatchedAt: T0,
      playedAt: T1,
      completedAt: T1,
      error: undefined,
    });
  });

  // The engine leaves `error` out once a verdict cleared it, but never unsets
  // a lifecycle timestamp, payload or attribution. `updatedAt` must describe
  // the lifecycle the row holds, so the applied snapshot's absence clears it.
  test("never overwrites a stored value with one the snapshot lacks, except the error and updatedAt", () => {
    const update = updateMirror(ROW, snap({ status: "completed", version: 4 }));
    expect(update.patch).toEqual({
      status: "completed",
      engineStatus: undefined,
      engineVersion: 4,
      engineUpdatedAt: undefined,
      dispatchedAt: T0,
      playedAt: T1,
      completedAt: T1,
      error: undefined,
    });
  });

  test("clears the stored error when the snapshot's is null", () => {
    const { snapshot, problems } = readAlertSnapshot({ id: "a1", status: "completed", version: 4, error: null });
    expect(problems).toEqual([]);
    const update = updateMirror(ROW, snapshot as EngineAlertSnapshot);
    expect("error" in update.patch && update.patch.error === undefined).toBe(true);
  });

  // A versioned write without a time leaves the row nothing to order an
  // unversioned straggler against, so the straggler cannot overwrite it.
  test("keeps an unversioned straggler off a versioned row whose last write carried no time", () => {
    const row = { ...ROW, ...updateMirror(ROW, snap({ status: "completed", version: 4 })).patch };
    expect(row.engineUpdatedAt).toBeUndefined();
    expect(updateMirror(row, snap({ status: "failed", updatedAt: T2 }))).toEqual({ patch: {}, progressed: false });
  });

  test("keeps the stored error when the snapshot's is unreadable", () => {
    const { snapshot } = readAlertSnapshot({ id: "a1", status: "replayed", version: 4, error: 7, payload: null });
    expect(snapshot).not.toBeNull();
    const update = updateMirror(ROW, snapshot as EngineAlertSnapshot);
    expect(update.patch.error).toBe("missing media");
    expect("payload" in update.patch).toBe(false);
  });

  test("changes nothing for a redelivery or an older write", () => {
    expect(updateMirror(ROW, snap({ status: "failed", version: 3, updatedAt: T1 }))).toEqual({
      patch: {},
      progressed: false,
    });
    expect(updateMirror(ROW, snap({ status: "playing", version: 2, updatedAt: T0 }))).toEqual({
      patch: {},
      progressed: false,
    });
  });

  test("fills in what the row was created without, even from an older write", () => {
    const row: EngineAlertMirror = { ...ROW, payload: undefined, workflowId: undefined, engineCreatedAt: undefined };
    const update = updateMirror(
      row,
      snap({ status: "sent", version: 1, payload: "{}", workflowId: "wf2", createdAt: T0, updatedAt: T0 })
    );
    expect(update).toEqual({ patch: { payload: "{}", workflowId: "wf2", engineCreatedAt: T0 }, progressed: false });
  });

  test("does not replace what the row was created with", () => {
    const update = updateMirror(ROW, snap({ status: "sent", version: 1, payload: "{}", createdAt: T2 }));
    expect(update.patch).toEqual({});
  });

  test("drops the version when it stores an unversioned snapshot", () => {
    const update = updateMirror(ROW, snap({ status: "completed", updatedAt: T2 }));
    expect(update.patch.status).toBe("completed");
    expect("engineVersion" in update.patch && update.patch.engineVersion === undefined).toBe(true);
  });

  test("keeps the version and the row when an unversioned snapshot cannot be ordered after it", () => {
    expect(updateMirror(ROW, snap({ status: "completed" }))).toEqual({ patch: {}, progressed: false });
  });

  test("reports a divergence and keeps the lifecycle", () => {
    const update = updateMirror(ROW, snap({ status: "completed", version: 3, updatedAt: T2 }));
    expect(update.divergence).toBeDefined();
    expect(update.patch).toEqual({});
  });
});

describe("mirrorOf", () => {
  test("leaves out what the first snapshot lacks", () => {
    expect(mirrorOf(snap({ status: "playing", version: 2 }))).toEqual({
      status: "playing",
      engineStatus: undefined,
      payload: undefined,
      workflowId: undefined,
      sourceEventId: undefined,
      envelopeId: undefined,
      dispatchedAt: undefined,
      playedAt: undefined,
      completedAt: undefined,
      error: undefined,
      engineVersion: 2,
      engineCreatedAt: undefined,
      engineUpdatedAt: undefined,
    });
  });

  test("keeps an unrecognised status beside unknown", () => {
    const mirror = mirrorOf(snap({ status: "cancelled" }));
    expect([mirror.status, mirror.engineStatus]).toEqual(["unknown", "cancelled"]);
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

  test("copies the version, as a number or as its decimal string", () => {
    expect(readAlertSnapshot({ ...snapshot, version: 3 }).snapshot).toEqual({ ...snapshot, version: 3 });
    expect(readAlertSnapshot({ ...snapshot, version: "3" })).toEqual({
      snapshot: { ...snapshot, version: 3 },
      problems: [],
    });
  });

  test("reads a version that is not a positive integer as absent, and reports it", () => {
    const unsafe = "9007199254740993";
    for (const version of [0, -1, 1.5, "0", "03", "-3", "1.5", " 3", "", unsafe, Number.NaN, null, true]) {
      const reading = readAlertSnapshot({ ...snapshot, version });
      expect(reading.snapshot).toEqual({ ...snapshot, unreadable: ["version"] });
      expect(reading.problems).toHaveLength(1);
    }
  });

  test("reads a null or mistyped optional field as absent, and reports it", () => {
    const reading = readAlertSnapshot({ ...snapshot, workflowId: null, error: 7, playedAt: 5 });
    const { playedAt: _playedAt, ...withoutPlayedAt } = snapshot;
    expect(reading.snapshot).toEqual({ ...withoutPlayedAt, unreadable: ["workflowId", "error", "playedAt"] });
    expect(reading.problems).toHaveLength(3);
  });

  test("reads a null error as no error, without a problem", () => {
    expect(readAlertSnapshot({ ...snapshot, error: null })).toEqual({ snapshot, problems: [] });
  });

  // Problems are logged, and a snapshot's text can hold viewer data.
  test("names a malformed field's type, never its value", () => {
    const reading = readAlertSnapshot({
      ...snapshot,
      error: { viewer: "secret" },
      payload: ["secret"],
      playedAt: "secret",
    });
    expect(reading.problems).toEqual([
      "payload is malformed (array); read as absent",
      "error is malformed (object); read as absent",
      "playedAt is malformed (string); read as absent",
    ]);
  });

  test("reads a timestamp that does not parse as absent, and reports it", () => {
    const reading = readAlertSnapshot({ ...snapshot, updatedAt: "", createdAt: "yesterday" });
    const { updatedAt: _updatedAt, createdAt: _createdAt, ...rest } = snapshot;
    expect(reading.snapshot).toEqual({ ...rest, unreadable: ["createdAt", "updatedAt"] });
    expect(reading.problems).toHaveLength(2);
  });

  test("leaves out a missing payload and timestamps without inventing them", () => {
    expect(readAlertSnapshot({ id: "a1", status: "playing" })).toEqual({
      snapshot: { id: "a1", status: "playing" },
      problems: [],
    });
  });

  test("refuses a snapshot without an id or a status", () => {
    expect(readAlertSnapshot({ ...snapshot, id: undefined }).snapshot).toBeNull();
    expect(readAlertSnapshot({ ...snapshot, id: "" }).snapshot).toBeNull();
    expect(readAlertSnapshot({ ...snapshot, status: 3 }).problems).toEqual(["status is malformed (number)"]);
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
