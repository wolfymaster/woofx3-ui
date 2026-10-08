import { describe, expect, test } from "bun:test";
import {
  ALERT_IN_FLIGHT_STALE_MS,
  ALERT_QUEUED_STALE_MS,
  acceptsTransition,
  type EngineAlertStatus,
  isFailureStatus,
  lastProgressAt,
  normaliseStatus,
  outcomeOf,
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

  test("lets an unknown status settle an alert in flight, never replace a verdict", () => {
    expect(acceptsTransition(at("playing"), at("unknown", T1))).toBe(true);
    expect(acceptsTransition(at("unknown"), at("completed", T1))).toBe(true);
    expect(acceptsTransition(at("completed"), at("unknown", T1))).toBe(false);
    expect(acceptsTransition(at("unknown"), at("sent", T1))).toBe(false);
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
  const now = 100 * ALERT_QUEUED_STALE_MS;

  test("counts an alert on its way as in flight", () => {
    expect(outcomeOf("sent", now - 1000, now)).toBe("inFlight");
    expect(outcomeOf("playing", now - ALERT_IN_FLIGHT_STALE_MS, now)).toBe("inFlight");
  });

  test("stops counting an alert in flight once no verdict can be expected", () => {
    expect(outcomeOf("sent", now - ALERT_IN_FLIGHT_STALE_MS - 1, now)).toBe("unconfirmed");
    expect(outcomeOf("playing", 0, now)).toBe("unconfirmed");
  });

  // A queued alert waits for an overlay to connect, which can take a whole break.
  test("gives a queued alert longer than a dispatched one", () => {
    expect(outcomeOf("pending", now - ALERT_IN_FLIGHT_STALE_MS - 1, now)).toBe("inFlight");
    expect(outcomeOf("pending", now - ALERT_QUEUED_STALE_MS - 1, now)).toBe("unconfirmed");
  });

  test("never ages a settled alert", () => {
    expect(outcomeOf("completed", 0, now)).toBe("completed");
    expect(outcomeOf("timed_out", 0, now)).toBe("failed");
    expect(outcomeOf("skipped", 0, now)).toBe("skipped");
    expect(outcomeOf("replayed", 0, now)).toBe("replayed");
    expect(outcomeOf("unknown", 0, now)).toBe("unknown");
  });
});

describe("lastProgressAt", () => {
  test("measures from the last progress the mirror saw", () => {
    expect(lastProgressAt({ progressedAt: 500, _creationTime: 100 })).toBe(500);
  });

  test("falls back to the row's creation", () => {
    expect(lastProgressAt({ _creationTime: 100 })).toBe(100);
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
