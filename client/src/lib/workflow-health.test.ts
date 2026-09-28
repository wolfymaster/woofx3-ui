import { describe, expect, it } from "bun:test";
import { notRunningById, notRunningSummary } from "./workflow-health";

describe("notRunningSummary", () => {
  it("is empty when every workflow runs", () => {
    expect(notRunningSummary(0)).toBe("");
  });

  it("agrees in number", () => {
    expect(notRunningSummary(1)).toBe("1 automation isn't running on its own");
    expect(notRunningSummary(2)).toBe("2 automations aren't running on their own");
  });
});

describe("notRunningById", () => {
  it("indexes by engine workflow id and tolerates a list still loading", () => {
    const entry = { engineWorkflowId: "wf-1", reason: "bad", since: "2026-09-28T10:00:00.000Z" };
    expect(notRunningById([entry]).get("wf-1")).toEqual(entry);
    expect(notRunningById(undefined).size).toBe(0);
  });
});
