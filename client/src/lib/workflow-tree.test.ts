import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "@woofx3/api";
import {
  countActionSteps,
  definitionToTree,
  insertStepInTree,
  removeStepFromTree,
  type StepNode,
  treeToDefinition,
} from "./workflow-tree";

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

  test("round-trip preserves $ref and function", () => {
    const trigger = { type: "event", event: "cheer.user.twitch", $ref: "twitch_platform:trigger:cheer.user" };
    const task = {
      id: "a1",
      type: "action",
      action: "function",
      parameters: {},
      $ref: "twitch_platform:action:chat.send",
      function: "twitch.chat.send",
    };
    const def = { ...baseDef, trigger, tasks: [task] } as unknown as WorkflowDefinition;
    const tree = definitionToTree(def);
    expect(tree.trigger.ref).toBe("twitch_platform:trigger:cheer.user");
    expect(tree.steps[0]).toMatchObject({ ref: "twitch_platform:action:chat.send", function: "twitch.chat.send" });

    const result = treeToDefinition(tree);
    expect((result.trigger as { $ref?: string }).$ref).toBe("twitch_platform:trigger:cheer.user");
    expect((result.tasks[0] as { $ref?: string; function?: string }).$ref).toBe("twitch_platform:action:chat.send");
    expect((result.tasks[0] as { $ref?: string; function?: string }).function).toBe("twitch.chat.send");
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

  test("branch children explicitly depend on their condition, not just onTrue/onFalse", () => {
    // The engine's execution order is a topological sort over dependsOn edges only;
    // onTrue/onFalse alone don't order anything. Without an explicit dependsOn back
    // to the condition, branch children would float as unordered root tasks.
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
    const a1 = result.tasks.find((t) => t.id === "a1");
    const a2 = result.tasks.find((t) => t.id === "a2");
    expect(a1?.dependsOn).toEqual(["c1"]);
    expect(a2?.dependsOn).toEqual(["c1"]);
  });

  test("a step after a condition block depends on the condition, not a branch's last task", () => {
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
        { id: "a3", type: "action", action: "thankYou", parameters: {} },
      ],
    };
    const tree = definitionToTree(def);
    const result = treeToDefinition(tree);
    const a3 = result.tasks.find((t) => t.id === "a3");
    // a3 is a top-level sibling after the condition — it must run regardless of
    // which branch was taken, so it should depend on c1 itself.
    expect(a3?.dependsOn).toEqual(["c1"]);
  });
});

describe("insertStepInTree", () => {
  const action1: StepNode = { type: "action", id: "a1", action: "function", parameters: {} };
  const action2: StepNode = { type: "action", id: "a2", action: "function", parameters: {} };
  const newStep: StepNode = { type: "wait", id: "new", wait: { type: "event", event: "" } };

  test("inserts at the root list when path is null", () => {
    const result = insertStepInTree([action1, action2], null, 1, newStep);
    expect(result.map((s) => s.id)).toEqual(["a1", "new", "a2"]);
  });

  test("inserts into a condition's thenBranch", () => {
    const cond: StepNode = { type: "condition", id: "c1", conditions: [], thenBranch: [action1], elseBranch: [] };
    const result = insertStepInTree([cond], { parentId: "c1", branch: "thenBranch" }, 1, newStep);
    const updated = result[0];
    expect(updated.type).toBe("condition");
    expect(updated.type === "condition" && updated.thenBranch.map((s) => s.id)).toEqual(["a1", "new"]);
    expect(updated.type === "condition" && updated.elseBranch).toEqual([]);
  });

  test("inserts into a nested condition's elseBranch, leaving siblings untouched", () => {
    const inner: StepNode = { type: "condition", id: "c2", conditions: [], thenBranch: [], elseBranch: [action2] };
    const outer: StepNode = { type: "condition", id: "c1", conditions: [], thenBranch: [inner], elseBranch: [action1] };
    const result = insertStepInTree([outer], { parentId: "c2", branch: "elseBranch" }, 0, newStep);
    const updatedOuter = result[0];
    expect(updatedOuter.type).toBe("condition");
    if (updatedOuter.type !== "condition") {
      throw new Error("expected condition");
    }
    expect(updatedOuter.elseBranch.map((s) => s.id)).toEqual(["a1"]);
    const updatedInner = updatedOuter.thenBranch[0];
    expect(updatedInner.type).toBe("condition");
    expect(updatedInner.type === "condition" && updatedInner.elseBranch.map((s) => s.id)).toEqual(["new", "a2"]);
  });
});

describe("removeStepFromTree", () => {
  const action1: StepNode = { type: "action", id: "a1", action: "function", parameters: {} };
  const action2: StepNode = { type: "action", id: "a2", action: "function", parameters: {} };
  const wait1: StepNode = { type: "wait", id: "w1", wait: { type: "event", event: "" } };

  test("removes a step from the root list", () => {
    const result = removeStepFromTree([action1, wait1, action2], "w1");
    expect(result.map((s) => s.id)).toEqual(["a1", "a2"]);
  });

  test("removes a step from a nested branch", () => {
    const cond: StepNode = {
      type: "condition",
      id: "c1",
      conditions: [],
      thenBranch: [action1, action2],
      elseBranch: [],
    };
    const result = removeStepFromTree([cond], "a1");
    const updated = result[0];
    expect(updated.type === "condition" && updated.thenBranch.map((s) => s.id)).toEqual(["a2"]);
  });

  test("removing a condition also removes everything in its branches", () => {
    const cond: StepNode = {
      type: "condition",
      id: "c1",
      conditions: [],
      thenBranch: [action1],
      elseBranch: [action2],
    };
    const result = removeStepFromTree([cond, wait1], "c1");
    expect(result.map((s) => s.id)).toEqual(["w1"]);
  });
});

describe("countActionSteps", () => {
  const action1: StepNode = { type: "action", id: "a1", action: "function", parameters: {} };
  const action2: StepNode = { type: "action", id: "a2", action: "function", parameters: {} };
  const wait1: StepNode = { type: "wait", id: "w1", wait: { type: "event", event: "" } };

  test("counts top-level actions only", () => {
    expect(countActionSteps([action1, wait1, action2])).toBe(2);
  });

  test("counts actions nested inside condition branches", () => {
    const cond: StepNode = {
      type: "condition",
      id: "c1",
      conditions: [],
      thenBranch: [action1],
      elseBranch: [action2],
    };
    expect(countActionSteps([cond, wait1])).toBe(2);
  });

  test("returns 0 for a tree with no actions", () => {
    expect(countActionSteps([wait1])).toBe(0);
  });
});
