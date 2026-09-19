import { describe, expect, test } from "bun:test";
import { describeTestEventOutcome } from "./test-event-outcome";

describe("describeTestEventOutcome", () => {
  test("waits while the subscription is still loading", () => {
    expect(describeTestEventOutcome(undefined, false).kind).toBe("waiting");
  });

  // Loading is not an answer, however long it has been. Only a confirmed
  // absence means nothing matched.
  test("keeps waiting on undefined even after the wait elapses", () => {
    expect(describeTestEventOutcome(undefined, true).kind).toBe("waiting");
  });

  test("treats an absent record as waiting until the wait elapses", () => {
    expect(describeTestEventOutcome(null, false).kind).toBe("waiting");
    expect(describeTestEventOutcome(null, true).kind).toBe("nothingMatched");
  });

  test("reports a run in progress", () => {
    expect(describeTestEventOutcome({ status: "progress" }, false).kind).toBe("running");
  });

  test("reports a completed run", () => {
    expect(describeTestEventOutcome({ status: "success" }, false).kind).toBe("succeeded");
  });

  // The payoff for sharing one vocabulary between validateAlertParams and
  // parseAlertLayout: a refused alert step arrives as a workflow failure and
  // still gets the advice written for alert failures, with no new mapping.
  test("turns a known engine reason into readable advice", () => {
    const outcome = describeTestEventOutcome(
      { status: "error", message: "alert cannot be published: layout must be an object, got nothing" },
      false
    );
    expect(outcome.kind).toBe("failed");
    expect(outcome).toMatchObject({ title: "This alert has no layout" });
    expect(outcome.kind === "failed" && outcome.detail).toContain("Update the module");
  });

  // The safety property: an unrecognised reason is shown verbatim rather than
  // mangled into advice that does not apply.
  test("shows an unrecognised reason unchanged", () => {
    const outcome = describeTestEventOutcome({ status: "error", message: "barkloader: function timed out" }, false);
    expect(outcome).toMatchObject({
      kind: "failed",
      title: "The workflow failed",
      detail: "barkloader: function timed out",
    });
  });

  test("still reports a failure the engine could not explain", () => {
    const outcome = describeTestEventOutcome({ status: "error" }, false);
    expect(outcome).toMatchObject({ kind: "failed", detail: "No reason was reported." });
  });
});
