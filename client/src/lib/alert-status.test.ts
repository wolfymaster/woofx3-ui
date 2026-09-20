import { describe, expect, test } from "bun:test";
import { alertStatusStyle, isFailureStatus, successRate } from "./alert-status";

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

describe("isFailureStatus", () => {
  test("counts a timeout as a failure, as the server's totals do", () => {
    expect(isFailureStatus("failed")).toBe(true);
    expect(isFailureStatus("timed_out")).toBe(true);
  });

  // A skip is an operator's decision and a replay supersedes its row; neither
  // is the overlay failing to play something.
  test("does not count a skip or a replay as a failure", () => {
    expect(isFailureStatus("skipped")).toBe(false);
    expect(isFailureStatus("replayed")).toBe(false);
    expect(isFailureStatus("playing")).toBe(false);
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
