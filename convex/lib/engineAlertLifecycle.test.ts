import { describe, expect, test } from "bun:test";
import {
  acceptsTransition,
  type EngineAlertStatus,
  isFailureStatus,
  normaliseStatus,
  outcomeOf,
  parseEngineTimestamp,
  readAlertSnapshot,
  UNSETTLED_STATUSES,
} from "./engineAlertLifecycle";

const T0 = "2026-09-17T08:49:58.000Z";
const T1 = "2026-09-17T08:50:03.000Z";

function at(status: EngineAlertStatus, engineUpdatedAt = T0) {
  return { status, engineUpdatedAt };
}

describe("acceptsTransition", () => {
  test("moves an alert forward through its lifecycle", () => {
    expect(acceptsTransition(at("sent"), at("dispatched", T1))).toBe(true);
    expect(acceptsTransition(at("dispatched"), at("playing", T1))).toBe(true);
    expect(acceptsTransition(at("playing"), at("completed", T1))).toBe(true);
    expect(acceptsTransition(at("sent"), at("failed", T1))).toBe(true);
  });

  // `alert.recorded` and the lifecycle callbacks are delivered independently,
  // so the recorded snapshot can arrive after the alert finished.
  test("does not let a late recorded snapshot revive a settled alert", () => {
    expect(acceptsTransition(at("completed", T1), at("sent"))).toBe(false);
    expect(acceptsTransition(at("skipped", T1), at("pending"))).toBe(false);
    expect(acceptsTransition(at("failed", T1), at("playing"))).toBe(false);
  });

  test("lets a late verdict replace an earlier one, as the engine does", () => {
    expect(acceptsTransition(at("timed_out", T0), at("completed", T1))).toBe(true);
  });

  // Verdicts share a stage, so a retried older verdict is told apart only by
  // the engine's timestamp.
  test("does not let a retried older verdict replace a newer one", () => {
    expect(acceptsTransition(at("completed", T1), at("timed_out", T0))).toBe(false);
  });

  test("rejects any snapshot older than the one stored", () => {
    expect(acceptsTransition(at("sent", T1), at("sent", T0))).toBe(false);
  });

  test("falls back to the stage when a timestamp does not parse", () => {
    expect(acceptsTransition(at("completed", "not a time"), at("timed_out", T0))).toBe(true);
    expect(acceptsTransition(at("completed", "not a time"), at("sent", T1))).toBe(false);
  });

  test("keeps a replayed row replayed", () => {
    expect(acceptsTransition(at("completed"), at("replayed", T1))).toBe(true);
    expect(acceptsTransition(at("replayed"), at("completed", T1))).toBe(false);
  });

  test("accepts a redelivered callback", () => {
    expect(acceptsTransition(at("sent"), at("sent"))).toBe(true);
    expect(acceptsTransition(at("completed"), at("completed"))).toBe(true);
  });

  // Engine rows carry microseconds; two writes in one millisecond must still
  // be told apart.
  test("orders snapshots below the millisecond", () => {
    const earlier = "2026-09-17T08:50:03.123400Z";
    const later = "2026-09-17T08:50:03.123456789Z";
    expect(acceptsTransition(at("completed", later), at("timed_out", earlier))).toBe(false);
    expect(acceptsTransition(at("timed_out", earlier), at("completed", later))).toBe(true);
  });

  test("accepts the same engine write written at different precisions", () => {
    expect(
      acceptsTransition(at("completed", "2026-09-17T08:50:03.120Z"), at("completed", "2026-09-17T08:50:03.12Z"))
    ).toBe(true);
  });

  test("orders by version when both snapshots carry one", () => {
    const stored = { status: "completed" as const, engineVersion: 4, engineUpdatedAt: T1 };
    expect(acceptsTransition(stored, { status: "failed", engineVersion: 5, engineUpdatedAt: T0 })).toBe(true);
    expect(acceptsTransition(stored, { status: "timed_out", engineVersion: 3, engineUpdatedAt: T1 })).toBe(false);
    expect(acceptsTransition(stored, { status: "playing", engineVersion: 2, engineUpdatedAt: T1 })).toBe(false);
  });

  test("accepts the same version delivered again", () => {
    const stored = { status: "playing" as const, engineVersion: 2, engineUpdatedAt: T1 };
    expect(acceptsTransition(stored, { ...stored })).toBe(true);
  });

  test("falls back to stage and timestamp when either snapshot has no version", () => {
    const versioned = { status: "completed" as const, engineVersion: 3, engineUpdatedAt: T1 };
    expect(acceptsTransition(at("completed", T1), { ...at("timed_out", T0), engineVersion: 9 })).toBe(false);
    expect(acceptsTransition(versioned, at("timed_out", T0))).toBe(false);
    expect(acceptsTransition(at("timed_out", T0), { ...at("completed", T1), engineVersion: 1 })).toBe(true);
  });

  // Only `alert.recorded` can carry a status this build does not know, so it
  // is the alert's starting point, not an ending.
  test("treats an unknown status as a starting point", () => {
    expect(acceptsTransition(at("unknown"), at("dispatched", T1))).toBe(true);
    expect(acceptsTransition(at("unknown"), at("playing", T1))).toBe(true);
    expect(acceptsTransition(at("unknown"), at("completed", T1))).toBe(true);
    expect(acceptsTransition(at("sent"), at("unknown", T1))).toBe(true);
    expect(acceptsTransition(at("playing"), at("unknown", T1))).toBe(false);
    expect(acceptsTransition(at("completed"), at("unknown", T1))).toBe(false);
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
    expect(readAlertSnapshot({ ...snapshot, addedLater: "x" })).toEqual(snapshot);
  });

  test("copies the version", () => {
    expect(readAlertSnapshot({ ...snapshot, version: 3 })).toEqual({ ...snapshot, version: 3 });
  });

  test("refuses a version that is not a positive integer", () => {
    for (const version of [0, -1, 1.5, "3", Number.NaN]) {
      expect(readAlertSnapshot({ ...snapshot, version })).toBeNull();
    }
  });

  test("refuses a snapshot missing a required field or with a mistyped one", () => {
    expect(readAlertSnapshot({ ...snapshot, id: undefined })).toBeNull();
    expect(readAlertSnapshot({ ...snapshot, playedAt: 5 })).toBeNull();
    expect(readAlertSnapshot(null)).toBeNull();
    expect(readAlertSnapshot("alert")).toBeNull();
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
