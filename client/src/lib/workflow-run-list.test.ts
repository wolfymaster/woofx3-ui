import { describe, expect, test } from "bun:test";
import type { WorkflowRun } from "@/lib/transport";
import { mergeWorkflowRun } from "./workflow-run-list";

function run(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflowId: "wf",
    workflowName: "Workflow",
    status: "running",
    startedAt: new Date(1000),
    ...overrides,
  };
}

describe("mergeWorkflowRun", () => {
  test("returns the same array when an existing run is unchanged", () => {
    const runs = [run("a"), run("b")];
    expect(mergeWorkflowRun(runs, run("a"), 20)).toBe(runs);
  });

  test("treats equal timestamps as unchanged whatever object carries them", () => {
    const runs = [run("a", { status: "completed", completedAt: new Date(5000) })];
    expect(mergeWorkflowRun(runs, run("a", { status: "completed", completedAt: new Date(5000) }), 20)).toBe(runs);
  });

  test("replaces a run in place when its status changes", () => {
    const runs = [run("a"), run("b")];
    const next = mergeWorkflowRun(runs, run("b", { status: "failed", error: "boom" }), 20);
    expect(next).not.toBe(runs);
    expect(next.map((r) => [r.id, r.status])).toEqual([
      ["a", "running"],
      ["b", "failed"],
    ]);
  });

  test("prepends a new run and trims to the limit", () => {
    const runs = [run("a"), run("b")];
    const next = mergeWorkflowRun(runs, run("c"), 2);
    expect(next.map((r) => r.id)).toEqual(["c", "a"]);
  });
});
