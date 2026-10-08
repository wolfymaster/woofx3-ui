import { describe, expect, test } from "bun:test";
import { alertStatusStyle, engineAlertStyle, successRate, unsettledDetail } from "./alert-status";

describe("alertStatusStyle", () => {
  test("names each lifecycle point in the words the UI uses", () => {
    expect(alertStatusStyle("completed").label).toBe("Played");
    expect(alertStatusStyle("timed_out").label).toBe("Timed out");
  });

  // The engine's status set grows; a build that does not know a value still
  // has to draw the row rather than crash on an undefined descriptor.
  test("falls back for a status this build does not know", () => {
    expect(alertStatusStyle("teleported")).toBe(alertStatusStyle("unknown"));
  });
});

describe("engineAlertStyle", () => {
  test("draws an alert on its way by its status", () => {
    expect(engineAlertStyle({ status: "sent" }).label).toBe("Sent");
  });

  test("draws an alert the server marked unconfirmed as unconfirmed", () => {
    expect(engineAlertStyle({ status: "playing", unconfirmedAt: 1 }).label).toBe("Unconfirmed");
    expect(engineAlertStyle({ status: "completed", unconfirmedAt: 1 }).label).toBe("Played");
  });

  test("draws a status the mirror could not read as unknown", () => {
    expect(engineAlertStyle({ status: "unknown" }).label).toBe("Unknown");
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
