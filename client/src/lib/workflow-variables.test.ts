import { describe, expect, test } from "bun:test";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { StepNode, TriggerNode, WorkflowTree } from "@/lib/workflow-tree";
import {
  collectStepIds,
  computeAvailableVariables,
  generateStepId,
  isStepIdReferenced,
  isValidStepId,
} from "./workflow-variables";

function catalogTrigger(overrides: Partial<CatalogTriggerRow>): CatalogTriggerRow {
  return {
    id: "t1",
    name: "Cheer",
    description: "",
    category: "twitch",
    color: "",
    icon: "Zap",
    event: "cheer.user.twitch",
    ...overrides,
  };
}

function catalogAction(overrides: Partial<CatalogActionRow>): CatalogActionRow {
  return {
    id: "a1",
    name: "Increment Counter",
    description: "",
    category: "counter",
    color: "",
    icon: "ArrowRight",
    canonicalRef: overrides.canonicalRef,
    ...overrides,
  };
}

const trigger: TriggerNode = { type: "trigger", id: "__trigger", event: "cheer.user.twitch", conditions: [] };
const triggerCatalog = [
  catalogTrigger({
    event: "cheer.user.twitch",
    configFields: [{ id: "user", label: "Cheerer", type: "text", eventPath: "user" }],
  }),
];
const actionCatalog = [
  catalogAction({
    canonicalRef: "counter:action:increment",
    configFields: [{ id: "step", label: "Step", type: "number" }],
    outputFields: [
      { id: "next", label: "New value", type: "number" },
      { id: "previous", label: "Previous value", type: "number" },
    ],
  }),
];

describe("isValidStepId", () => {
  test("accepts letters, numbers, dots, underscores, hyphens", () => {
    expect(isValidStepId("increment-counter")).toBe(true);
    expect(isValidStepId("action_1.step")).toBe(true);
  });

  test("rejects spaces and other punctuation", () => {
    expect(isValidStepId("my step")).toBe(false);
    expect(isValidStepId("step/1")).toBe(false);
    expect(isValidStepId("")).toBe(false);
  });
});

describe("generateStepId", () => {
  test("slugifies the label when unused", () => {
    expect(generateStepId("Increment Counter", new Set())).toBe("increment-counter");
  });

  test("disambiguates against existing ids with a numeric suffix", () => {
    const existing = new Set(["increment-counter", "increment-counter-2"]);
    expect(generateStepId("Increment Counter", existing)).toBe("increment-counter-3");
  });

  test("falls back to a generic slug for a label with no alphanumerics", () => {
    expect(generateStepId("!!!", new Set())).toBe("step");
  });
});

describe("collectStepIds", () => {
  test("collects ids from nested condition branches", () => {
    const action1: StepNode = { type: "action", id: "a1", action: "function", parameters: {} };
    const action2: StepNode = { type: "action", id: "a2", action: "function", parameters: {} };
    const cond: StepNode = {
      type: "condition",
      id: "c1",
      conditions: [],
      thenBranch: [action1],
      elseBranch: [action2],
    };
    expect(collectStepIds([cond])).toEqual(new Set(["c1", "a1", "a2"]));
  });
});

describe("isStepIdReferenced", () => {
  test("finds a ${id.field} reference inside another action's parameters", () => {
    const action1: StepNode = { type: "action", id: "a1", action: "function", parameters: {} };
    const action2: StepNode = {
      type: "action",
      id: "a2",
      action: "function",
      parameters: { message: "Count is now ${a1.next}" },
    };
    expect(isStepIdReferenced([action1, action2], "a1")).toBe(true);
  });

  test("does not false-positive on an unrelated id that is a prefix of another", () => {
    const action1: StepNode = { type: "action", id: "a1", action: "function", parameters: {} };
    const action2: StepNode = {
      type: "action",
      id: "a2",
      action: "function",
      parameters: { message: "${a10.next}" },
    };
    expect(isStepIdReferenced([action1, action2], "a1")).toBe(false);
  });

  test("finds references nested inside condition branch parameters", () => {
    const inner: StepNode = {
      type: "action",
      id: "a2",
      action: "function",
      parameters: { step: "${a1.next}" },
    };
    const cond: StepNode = { type: "condition", id: "c1", conditions: [], thenBranch: [inner], elseBranch: [] };
    const action1: StepNode = { type: "action", id: "a1", action: "function", parameters: {} };
    expect(isStepIdReferenced([action1, cond], "a1")).toBe(true);
  });

  test("returns false when there are no references", () => {
    const action1: StepNode = { type: "action", id: "a1", action: "function", parameters: {} };
    const action2: StepNode = { type: "action", id: "a2", action: "function", parameters: { message: "hi" } };
    expect(isStepIdReferenced([action1, action2], "a1")).toBe(false);
  });
});

describe("computeAvailableVariables", () => {
  const increment: StepNode = {
    type: "action",
    id: "increment",
    action: "function",
    ref: "counter:action:increment",
    parameters: {},
  };

  test("offers trigger data fields with an eventPath", () => {
    const tree: WorkflowTree = { trigger, steps: [increment] };
    const options = computeAvailableVariables(tree, "increment", actionCatalog, triggerCatalog);
    expect(options).toContainEqual(
      expect.objectContaining({ value: "${trigger.data.user}", label: "Cheerer", group: "Trigger" })
    );
  });

  test("offers an earlier action step's declared outputs", () => {
    const secondStep: StepNode = { type: "action", id: "notify", action: "function", parameters: {} };
    const tree: WorkflowTree = { trigger, steps: [increment, secondStep] };
    const options = computeAvailableVariables(tree, "notify", actionCatalog, triggerCatalog);
    expect(options).toContainEqual(
      expect.objectContaining({ value: "${increment.next}", label: "New value", group: "Increment Counter" })
    );
    expect(options).toContainEqual(
      expect.objectContaining({
        value: "${increment.previous}",
        label: "Previous value",
        group: "Increment Counter",
      })
    );
  });

  test("does not offer a later step's outputs", () => {
    const secondStep: StepNode = { type: "action", id: "notify", action: "function", parameters: {} };
    const tree: WorkflowTree = { trigger, steps: [increment, secondStep] };
    const options = computeAvailableVariables(tree, "increment", actionCatalog, triggerCatalog);
    expect(options.some((o) => o.group !== "Trigger")).toBe(false);
  });

  test("a step inside a branch sees the condition's result and everything before the condition", () => {
    const insideBranch: StepNode = { type: "action", id: "inside", action: "function", parameters: {} };
    const cond: StepNode = {
      type: "condition",
      id: "big-cheer",
      conditions: [],
      thenBranch: [insideBranch],
      elseBranch: [],
    };
    const tree: WorkflowTree = { trigger, steps: [increment, cond] };
    const options = computeAvailableVariables(tree, "inside", actionCatalog, triggerCatalog);
    expect(options).toContainEqual(
      expect.objectContaining({ value: "${increment.next}", label: "New value", group: "Increment Counter" })
    );
    expect(options).toContainEqual(
      expect.objectContaining({ value: "${big-cheer.result}", label: "Condition result", group: "Condition" })
    );
  });

  test("a step after a condition block sees the condition's result but not either branch's internals", () => {
    const thenChild: StepNode = { type: "action", id: "then-child", action: "function", parameters: {} };
    const elseChild: StepNode = { type: "action", id: "else-child", action: "function", parameters: {} };
    const cond: StepNode = {
      type: "condition",
      id: "big-cheer",
      conditions: [],
      thenBranch: [thenChild],
      elseBranch: [elseChild],
    };
    const after: StepNode = { type: "action", id: "after", action: "function", parameters: {} };
    const tree: WorkflowTree = { trigger, steps: [cond, after] };
    const options = computeAvailableVariables(tree, "after", actionCatalog, triggerCatalog);
    expect(options).toContainEqual(
      expect.objectContaining({ value: "${big-cheer.result}", label: "Condition result", group: "Condition" })
    );
    // Neither branch child ran (only one branch executes), so their step ids must not appear at all.
    expect(options.some((o) => o.value.startsWith("${then-child.") || o.value.startsWith("${else-child."))).toBe(false);
  });

  // Conditions and waits are addressed by the same walk as actions — the editor now asks for
  // their variables too, so the target being a non-action step has to work.
  test("a condition step sees the trigger and upstream action outputs", () => {
    const cond: StepNode = {
      type: "condition",
      id: "big-cheer",
      conditions: [],
      thenBranch: [],
      elseBranch: [],
    };
    const tree: WorkflowTree = { trigger, steps: [increment, cond] };
    const options = computeAvailableVariables(tree, "big-cheer", actionCatalog, triggerCatalog);
    expect(options).toContainEqual(
      expect.objectContaining({ value: "${trigger.data.user}", label: "Cheerer", group: "Trigger" })
    );
    expect(options).toContainEqual(
      expect.objectContaining({ value: "${increment.next}", label: "New value", group: "Increment Counter" })
    );
    // Its own result isn't available to itself.
    expect(options.some((o) => o.value === "${big-cheer.result}")).toBe(false);
  });

  test("a wait step sees upstream action outputs", () => {
    const wait: StepNode = { type: "wait", id: "hold", wait: { type: "event", event: "" } };
    const tree: WorkflowTree = { trigger, steps: [increment, wait] };
    const options = computeAvailableVariables(tree, "hold", actionCatalog, triggerCatalog);
    expect(options).toContainEqual(
      expect.objectContaining({ value: "${increment.next}", label: "New value", group: "Increment Counter" })
    );
  });

  test("a step in one branch does not see a sibling branch's steps", () => {
    const thenChild: StepNode = { type: "action", id: "then-child", action: "function", parameters: {} };
    const elseChild: StepNode = { type: "action", id: "else-child", action: "function", parameters: {} };
    const cond: StepNode = {
      type: "condition",
      id: "big-cheer",
      conditions: [],
      thenBranch: [thenChild],
      elseBranch: [elseChild],
    };
    const tree: WorkflowTree = { trigger, steps: [cond] };
    const options = computeAvailableVariables(tree, "else-child", actionCatalog, triggerCatalog);
    expect(options.some((o) => o.value.startsWith("${then-child."))).toBe(false);
  });
});

describe("computeAvailableVariables — type and description", () => {
  // Reuses the module-level catalogTrigger/catalogAction helpers so this
  // matches how the catalog really shapes rows.
  const typedTriggerCatalog = [
    catalogTrigger({
      event: "cheer.user.twitch",
      configFields: [
        { id: "bits", label: "Bits", type: "number", eventPath: "bits", description: "How many bits were cheered." },
        { id: "user", label: "Cheerer", type: "text", eventPath: "user" },
      ],
    }),
  ];

  // `increment` is scoped to the sibling describe, so it is restated here.
  const increment: StepNode = {
    type: "action",
    id: "increment",
    action: "function",
    ref: "counter:action:increment",
    parameters: {},
  };

  const tree: WorkflowTree = { trigger, steps: [increment] };

  test("carries the catalog's declared type onto each trigger variable", () => {
    const options = computeAvailableVariables(tree, "increment", actionCatalog, typedTriggerCatalog);
    expect(options.find((o) => o.value === "${trigger.data.bits}")?.type).toBe("number");
    expect(options.find((o) => o.value === "${trigger.data.user}")?.type).toBe("text");
  });

  test("carries a description when the module author wrote one", () => {
    const options = computeAvailableVariables(tree, "increment", actionCatalog, typedTriggerCatalog);
    expect(options.find((o) => o.value === "${trigger.data.bits}")?.description).toBe("How many bits were cheered.");
  });

  test("leaves description undefined rather than inventing one", () => {
    const options = computeAvailableVariables(tree, "increment", actionCatalog, typedTriggerCatalog);
    expect(options.find((o) => o.value === "${trigger.data.user}")?.description).toBeUndefined();
  });

  test("carries the declared type onto an upstream action's outputs", () => {
    const later: StepNode = { type: "action", id: "later", action: "function", parameters: {} };
    const options = computeAvailableVariables(
      { trigger, steps: [increment, later] },
      "later",
      actionCatalog,
      typedTriggerCatalog
    );
    expect(options.find((o) => o.value === "${increment.next}")?.type).toBe("number");
  });

  test("marks a condition result as boolean", () => {
    const cond: StepNode = { type: "condition", id: "c1", conditions: [], thenBranch: [], elseBranch: [] };
    const after: StepNode = { type: "action", id: "after", action: "function", parameters: {} };
    const options = computeAvailableVariables(
      { trigger, steps: [cond, after] },
      "after",
      actionCatalog,
      typedTriggerCatalog
    );
    expect(options.find((o) => o.value === "${c1.result}")?.type).toBe("boolean");
  });
});
