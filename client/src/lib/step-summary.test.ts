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
    { id: "target", label: "Counter", type: "resource_ref", resourceKind: "counter" },
    { id: "amount", label: "Amount", type: "number" },
  ],
};

describe("stepSummary", () => {
  test("an action reads as its catalog name and configured settings", () => {
    const step: StepNode = {
      type: "action",
      id: "inc",
      action: "function",
      function: "woofx3:function:counter.increment",
      ref: "woofx3:action:counter.increment",
      parameters: { target: "woofx3:counter:hype", amount: 2 },
    };
    const summary = stepSummary(step, {
      action: increment,
      resourceLabels: new Map([["woofx3:counter:hype", "Hype"]]),
    });
    expect(summary).toEqual({ title: "Increment counter", details: ["Counter: Hype", "Amount: 2"], editable: true });
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
    expect(wait.title).toBe("Wait until follow");
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
