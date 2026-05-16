import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@woofx3/api";
import { definitionToTree, treeToDefinition } from "./workflow-tree";

const baseDef: WorkflowDefinition = {
  id: "wf-1",
  name: "Test Workflow",
  trigger: { type: "event", event: "cheer.user.twitch" },
  tasks: [],
};

describe("definitionToTree", () => {
  test("trigger-only workflow", () => {
    const tree = definitionToTree(baseDef);
    expect(tree.trigger.type).toBe("trigger");
    expect(tree.trigger.event).toBe("cheer.user.twitch");
    expect(tree.steps).toHaveLength(0);
  });

  test("linear action sequence", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        { id: "a1", type: "action", action: "sendMessage", parameters: {} },
        { id: "a2", type: "action", action: "playSound", parameters: {}, dependsOn: ["a1"] },
      ],
    };
    const tree = definitionToTree(def);
    expect(tree.steps).toHaveLength(2);
    expect(tree.steps[0].type).toBe("action");
    expect(tree.steps[1].type).toBe("action");
  });

  test("condition with branches", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        {
          id: "c1",
          type: "condition",
          conditions: [{ field: "amount", operator: "gte", value: 100 }],
          onTrue: ["a1"],
          onFalse: ["a2"],
        },
        { id: "a1", type: "action", action: "bigCheer", parameters: {} },
        { id: "a2", type: "action", action: "smallCheer", parameters: {} },
      ],
    };
    const tree = definitionToTree(def);
    expect(tree.steps).toHaveLength(1);
    expect(tree.steps[0].type).toBe("condition");
    const cond = tree.steps[0] as { type: "condition"; thenBranch: unknown[]; elseBranch: unknown[] };
    expect(cond.thenBranch).toHaveLength(1);
    expect(cond.elseBranch).toHaveLength(1);
  });

  test("wait node", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [{ id: "w1", type: "wait", wait: { type: "event", event: "follow" } }],
    };
    const tree = definitionToTree(def);
    expect(tree.steps[0].type).toBe("wait");
  });
});

describe("treeToDefinition", () => {
  test("round-trip preserves trigger", () => {
    const tree = definitionToTree(baseDef);
    const def = treeToDefinition(tree);
    expect(def.trigger.event).toBe("cheer.user.twitch");
  });

  test("round-trip preserves linear sequence", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        { id: "a1", type: "action", action: "sendMessage", parameters: {} },
        { id: "a2", type: "action", action: "playSound", parameters: {}, dependsOn: ["a1"] },
      ],
    };
    const tree = definitionToTree(def);
    const result = treeToDefinition(tree);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].id).toBe("a1");
    expect(result.tasks[1].id).toBe("a2");
  });

  test("round-trip preserves condition branches", () => {
    const def: WorkflowDefinition = {
      ...baseDef,
      tasks: [
        {
          id: "c1",
          type: "condition",
          conditions: [{ field: "amount", operator: "gte", value: 100 }],
          onTrue: ["a1"],
          onFalse: ["a2"],
        },
        { id: "a1", type: "action", action: "bigCheer", parameters: {} },
        { id: "a2", type: "action", action: "smallCheer", parameters: {} },
      ],
    };
    const tree = definitionToTree(def);
    const result = treeToDefinition(tree);
    const cond = result.tasks.find((t) => t.id === "c1");
    expect(cond).toBeDefined();
    expect(cond?.onTrue).toContain("a1");
    expect(cond?.onFalse).toContain("a2");
  });
});
