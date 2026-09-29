import { describe, expect, test } from "bun:test";
import { workflowEditorTab, workflowRunPath, workflowRunsPath } from "@/lib/workflow-run-route";

describe("workflow run routes", () => {
  test("a run's path sits under its workflow", () => {
    expect(workflowRunPath("wf-1", "run-1")).toBe("/stream/workflows/wf-1/runs/run-1");
  });

  test("the runs path opens the editor on the Runs tab", () => {
    const path = workflowRunsPath("wf-1");
    expect(workflowEditorTab(path.slice(path.indexOf("?")))).toBe("runs");
  });

  test("the editor opens on the steps unless the runs are asked for", () => {
    expect(workflowEditorTab("")).toBe("steps");
    expect(workflowEditorTab("?tab=other")).toBe("steps");
    expect(workflowEditorTab("tab=runs")).toBe("runs");
  });
});
