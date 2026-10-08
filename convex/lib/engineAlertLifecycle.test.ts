import { describe, expect, test } from "bun:test";
import { ALERT_IN_FLIGHT_STALE_MS, acceptsTransition, outcomeOf } from "./engineAlertLifecycle";

describe("acceptsTransition", () => {
  test("moves an alert forward through its lifecycle", () => {
    expect(acceptsTransition("sent", "dispatched")).toBe(true);
    expect(acceptsTransition("dispatched", "playing")).toBe(true);
    expect(acceptsTransition("playing", "completed")).toBe(true);
    expect(acceptsTransition("sent", "failed")).toBe(true);
  });

  // `alert.recorded` and the lifecycle callbacks are delivered independently,
  // so the recorded snapshot can arrive after the alert finished.
  test("does not let a late recorded snapshot revive a settled alert", () => {
    expect(acceptsTransition("completed", "sent")).toBe(false);
    expect(acceptsTransition("skipped", "pending")).toBe(false);
    expect(acceptsTransition("failed", "playing")).toBe(false);
  });

  test("lets a late verdict replace an earlier one, as the engine does", () => {
    expect(acceptsTransition("timed_out", "completed")).toBe(true);
  });

  test("keeps a replayed row replayed", () => {
    expect(acceptsTransition("completed", "replayed")).toBe(true);
    expect(acceptsTransition("replayed", "completed")).toBe(false);
  });

  test("accepts a redelivered callback", () => {
    expect(acceptsTransition("sent", "sent")).toBe(true);
    expect(acceptsTransition("completed", "completed")).toBe(true);
  });
});

describe("outcomeOf", () => {
  const now = 10 * ALERT_IN_FLIGHT_STALE_MS;

  test("counts an alert on its way as in flight", () => {
    expect(outcomeOf("sent", now - 1000, now)).toBe("inFlight");
    expect(outcomeOf("playing", now - ALERT_IN_FLIGHT_STALE_MS, now)).toBe("inFlight");
  });

  test("stops counting an alert in flight once no verdict can be expected", () => {
    expect(outcomeOf("sent", now - ALERT_IN_FLIGHT_STALE_MS - 1, now)).toBe("unconfirmed");
    expect(outcomeOf("playing", 0, now)).toBe("unconfirmed");
  });

  test("never ages a settled alert", () => {
    expect(outcomeOf("completed", 0, now)).toBe("completed");
    expect(outcomeOf("timed_out", 0, now)).toBe("failed");
    expect(outcomeOf("skipped", 0, now)).toBe("skipped");
    expect(outcomeOf("replayed", 0, now)).toBe("replayed");
  });
});
