import { describe, expect, test } from "bun:test";
import { ALERT_IN_FLIGHT_STALE_MS } from "@convex/lib/engineAlertLifecycle";
import { alertStatusStyle, engineAlertStyle, successRate, unsettledDetail } from "./alert-status";

describe("alertStatusStyle", () => {
  test("names each lifecycle point in the words the UI uses", () => {
    expect(alertStatusStyle("completed").label).toBe("Played");
    expect(alertStatusStyle("timed_out").label).toBe("Timed out");
  });

  // The engine's status set grows; a build that does not know a value still
  // has to draw the row rather than crash on an undefined descriptor.
  test("falls back for a status this build does not know", () => {
    expect(alertStatusStyle("teleported")).toBe(alertStatusStyle("sent"));
  });
});

describe("engineAlertStyle", () => {
  const now = 2 * ALERT_IN_FLIGHT_STALE_MS;

  test("draws an alert on its way by its status", () => {
    expect(engineAlertStyle("sent", now - 1000, now).label).toBe("Sent");
  });

  test("stops drawing an alert that never settled as still on its way", () => {
    expect(engineAlertStyle("playing", 0, now).label).toBe("Unconfirmed");
    expect(engineAlertStyle("completed", 0, now).label).toBe("Played");
  });

  test("draws a status the mirror could not read as unknown", () => {
    expect(engineAlertStyle("unknown", 0, now).label).toBe("Unknown");
  });
});

describe("unsettledDetail", () => {
  test("is null when everything settled", () => {
    expect(unsettledDetail({ inFlight: 0, unconfirmed: 0 })).toBeNull();
  });

  // One playing alert must not hide the ones the engine lost track of.
  test("names in-flight and unconfirmed alerts together", () => {
    expect(unsettledDetail({ inFlight: 1, unconfirmed: 12 })).toBe("1 in flight · 12 never confirmed");
    expect(unsettledDetail({ inFlight: 0, unconfirmed: 3 })).toBe("3 never confirmed");
    expect(unsettledDetail({ inFlight: 2, unconfirmed: 0 })).toBe("2 in flight");
  });
});

describe("successRate", () => {
  test("is the share of settled alerts that played", () => {
    expect(successRate({ completed: 3, failed: 1 })).toBe(0.75);
  });

  // Nothing settled is not a 0% success rate, and showing one would say the
  // overlay is broken when it has simply had nothing to do.
  test("is null when nothing has settled", () => {
    expect(successRate({ completed: 0, failed: 0 })).toBeNull();
  });
});
