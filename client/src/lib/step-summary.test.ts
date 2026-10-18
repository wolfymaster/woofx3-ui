import { describe, expect, test } from "bun:test";
import type { CatalogActionRow } from "@/hooks/use-workflow-catalog";
import { conditionText, stepSummary } from "@/lib/step-summary";
import type { StepNode } from "@/lib/workflow-tree";

const increment: CatalogActionRow = {
  id: "row-1",
  canonicalRef: "woofx3:action:counter.increment",
  handlerType: "function",
  functionCall: "woofx3:function:counter.increment",
  name: "Increment counter",
  description: "",
  category: "Counters",
  color: "#888",
  icon: "Plus",
  configFields: [
    { id: "target", label: "Counter", type: "resource_ref", resourceKind: "counter", required: true },
    { id: "amount", label: "Amount", type: "number" },
  ],
};

describe("stepSummary", () => {
  const incrementStep = (parameters: Record<string, unknown>): StepNode => ({
    type: "action",
    id: "inc",
    action: "function",
    function: "woofx3:function:counter.increment",
    ref: "woofx3:action:counter.increment",
    parameters,
  });
  const hypeLabels = new Map([["woofx3:counter:hype", "Hype"]]);

  test("an action reads as its sentence, filled from its settings", () => {
    const summary = stepSummary(incrementStep({ target: "woofx3:counter:hype", amount: 2 }), {
      action: { ...increment, sentence: "Add {amount} to {target}" },
      resourceLabels: hypeLabels,
    });
    expect(summary.title).toBe("Add 2 to Hype");
    expect(summary.parts?.map((part) => part.text)).toEqual(["Add ", "2", " to ", "Hype"]);
    expect(summary.needs).toBeUndefined();
  });

  test("an action declaring no sentence reads as its name and settings", () => {
    const summary = stepSummary(incrementStep({ target: "woofx3:counter:hype", amount: 2 }), {
      action: increment,
      resourceLabels: hypeLabels,
    });
    expect(summary.title).toBe("Increment counter: counter Hype, amount 2");
    expect(summary.details).toEqual([]);
  });

  test("an action names the required settings it still needs", () => {
    const summary = stepSummary(incrementStep({}), { action: { ...increment, sentence: "Add {amount} to {target}" } });
    expect(summary.title).toBe("Add the default amount to a counter");
    expect(summary.needs).toEqual(["Counter"]);
  });

  test("a scene and its widget read by name", () => {
    const visibility: CatalogActionRow = {
      ...increment,
      name: "Set widget visibility",
      sentence: "Show or hide {placementId} on {sceneId}",
      configFields: [
        { id: "sceneId", label: "Scene", type: "text", required: true, source: { kind: "scenes" } },
        {
          id: "placementId",
          label: "Widget",
          type: "text",
          required: true,
          source: { kind: "scenePlacements", sceneField: "sceneId" },
        },
      ],
    };
    const step: StepNode = {
      type: "action",
      id: "v",
      action: "scene.widget.visibility",
      parameters: { sceneId: "s1", placementId: "p1" },
    };
    const scenes = [{ engineSceneId: "s1", name: "Main overlay", widgets: [{ id: "p1", name: "Camera" }] }];
    expect(stepSummary(step, { action: visibility, scenes }).title).toBe("Show or hide Camera on Main overlay");
  });

  test("an action without a sentence reads with the thing it points at in its name, and drops that setting", () => {
    const step: StepNode = {
      type: "action",
      id: "inc",
      action: "function",
      ref: "woofx3:action:counter.increment",
      parameters: { target: "woofx3:counter:hype", amount: 2 },
    };
    const target = { field: { id: "target", label: "Counter", type: "resource_ref" as const }, label: "Hype" };
    expect(stepSummary(step, { action: increment, target }).title).toBe("Increment Hype counter: amount 2");
  });

  test("an action's sentence names the thing it points at in that setting's place", () => {
    const step: StepNode = {
      type: "action",
      id: "inc",
      action: "function",
      ref: "woofx3:action:counter.increment",
      parameters: { target: "woofx3:counter:hype", amount: 2 },
    };
    const target = { field: { id: "target", label: "Counter", type: "resource_ref" as const }, label: "Hype" };
    const action = { ...increment, sentence: "Add {amount} to {target}" };
    expect(stepSummary(step, { action, target }).title).toBe("Add 2 to Hype");
  });

  test("an action the catalog lacks reads as its handler", () => {
    const step: StepNode = { type: "action", id: "x", action: "alert", parameters: {} };
    expect(stepSummary(step).title).toBe("alert");
  });

  test("a condition reads as If and its conditions joined by its logic", () => {
    const step: StepNode = {
      type: "condition",
      id: "c",
      conditionLogic: "or",
      conditions: [
        { field: "trigger.data.amount", operator: "gte", value: 100 },
        { field: "trigger.data.user", operator: "exists" },
      ],
      thenBranch: [],
      elseBranch: [],
    };
    expect(stepSummary(step).title).toBe("If trigger.data.amount is at least 100 or trigger.data.user is set");
  });

  test("an empty condition says it has none yet", () => {
    const step: StepNode = { type: "condition", id: "c", conditions: [], thenBranch: [], elseBranch: [] };
    expect(stepSummary(step)).toEqual({ title: "If …", details: ["No conditions yet"], editable: true });
  });

  test("a delay reads as a pause and an event wait as what it waits for", () => {
    expect(stepSummary({ type: "wait", id: "p", wait: { type: "delay", durationMs: 5000 } }).title).toBe(
      "Pause for 5s"
    );
    const wait = stepSummary({ type: "wait", id: "w", wait: { type: "event", event: "follow", timeout: "1m" } });
    expect(wait.title).toBe("Wait until follow happens");
    expect(wait.details).toEqual(["Gives up after 1m, then fails the workflow"]);
  });

  test("steps the flow can't edit say they are kept as they are", () => {
    expect(stepSummary({ type: "log", id: "l", parameters: { message: "hi" } })).toEqual({
      title: 'Log "hi"',
      details: ["Kept as is on save"],
      editable: false,
    });
    expect(stepSummary({ type: "workflow", id: "w", workflow: { workflowId: "other" } }).title).toBe(
      "Run workflow other"
    );
    expect(stepSummary({ type: "unknown", id: "u", taskType: "teleport" })).toEqual({
      title: "Unsupported step (teleport)",
      details: ["Kept as is on save"],
      editable: false,
    });
  });

  test("a turned off or guarded step says so", () => {
    const step: StepNode = {
      type: "action",
      id: "x",
      action: "alert",
      parameters: {},
      disabled: true,
      conditions: [{ field: "trigger.data.tier", operator: "eq", value: "1000" }],
    };
    expect(stepSummary(step).details).toEqual(["Turned off", "Only if trigger.data.tier is 1000"]);
  });
});

describe("conditionText", () => {
  test("reads between as a range and lists as text", () => {
    expect(conditionText({ field: "x", operator: "between", value: [1, 5] })).toBe("x is between 1 and 5");
    expect(conditionText({ field: "x", operator: "in", value: ["a", "b"] })).toBe("x is one of a, b");
  });
});
