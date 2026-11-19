import { describe, expect, test } from "bun:test";
import { stepSummary } from "@/lib/step-summary";
import { definitionToTree, type StepNode, treeToDefinition, type WorkflowTree } from "@/lib/workflow-tree";

const steps: StepNode[] = [
  { type: "action", id: "greet", function: "chat", action: "function", parameters: { message: "Hi" } },
  {
    type: "condition",
    id: "enough-bits",
    conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }],
    thenBranch: [{ type: "wait", id: "hold", wait: { type: "delay", ms: 5000 } }],
    elseBranch: [
      { type: "action", id: "thanks", function: "chat", action: "function", parameters: { message: "Thanks" } },
    ],
  },
  { type: "action", id: "alert", function: "alert", action: "function", parameters: {} },
];

const original: WorkflowTree = {
  trigger: { type: "trigger", id: "trigger", event: "twitch:cheer", conditions: [] },
  steps,
};

describe("the sentence's tree", () => {
  test("branches, waits and nested steps survive a definition round trip", () => {
    const definition = treeToDefinition(original);
    const read = definitionToTree(definition);
    expect(read.editable).toBe(true);
    expect(read.tree.steps.map((step) => step.id)).toEqual(["greet", "enough-bits", "alert"]);
    const condition = read.tree.steps[1];
    expect(condition.type).toBe("condition");
    if (condition.type === "condition") {
      expect(condition.thenBranch[0]).toMatchObject({ id: "hold", type: "wait", wait: { type: "delay", ms: 5000 } });
      expect(condition.elseBranch[0]).toMatchObject({ id: "thanks", type: "action" });
    }
    expect(treeToDefinition(read.tree)).toEqual(definition);
  });

  test("every step keeps a first-class sentence phrase", () => {
    for (const step of steps) {
      expect(stepSummary(step).title.length).toBeGreaterThan(0);
      if (step.type === "condition") {
        expect(stepSummary(step).title.toLowerCase()).toContain("if");
        for (const child of [...step.thenBranch, ...step.elseBranch]) {
          expect(stepSummary(child).title.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
