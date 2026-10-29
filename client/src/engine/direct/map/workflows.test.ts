import { describe, expect, test } from "bun:test";
import type { ParsedWorkflowHealth } from "@shared/workflow-health";
import type {
  ActionDefinition,
  Workflow as EngineWorkflow,
  WorkflowRunDetail as EngineWorkflowRunDetail,
  TriggerDefinition,
} from "@woofx3/api";
import {
  toNotRunning,
  toRecordedWorkflowRun,
  toWorkflow,
  toWorkflowCatalog,
  toWorkflowRun,
  toWorkflowRunDetail,
} from "./workflows";

const NOW = 1_700_000_000_000;

const engineWorkflow: EngineWorkflow = {
  id: "w-1",
  name: "Follow",
  description: "",
  isEnabled: true,
  definition: {
    id: "w-1",
    name: "Follow",
    trigger: { type: "event", event: "channel.follow", $ref: "woofx3:trigger:follow" } as never,
    tasks: [],
  },
  stats: { runsToday: 0, successRate: 0 },
  createdAt: "2026-10-28T10:00:00Z",
  updatedAt: "2026-10-28T11:00:00Z",
};

describe("toWorkflow", () => {
  test("escapes the definition's `$` keys and reads the engine's times", () => {
    const workflow = toWorkflow(engineWorkflow);
    expect(workflow).toMatchObject({
      engineWorkflowId: "w-1",
      isEnabled: true,
      createdAt: Date.parse("2026-10-28T10:00:00Z"),
      updatedAt: Date.parse("2026-10-28T11:00:00Z"),
    });
    expect((workflow?.definition as { trigger: Record<string, unknown> }).trigger).toHaveProperty("__$ref");
  });

  test("a workflow with no definition yet is left out", () => {
    expect(toWorkflow({ ...engineWorkflow, definition: null })).toBeNull();
  });

  test("a time that does not parse is refused", () => {
    expect(() => toWorkflow({ ...engineWorkflow, updatedAt: "" })).toThrow("not a time");
  });
});

describe("toWorkflowCatalog", () => {
  const trigger = (id: string, overrides: Partial<TriggerDefinition> = {}): TriggerDefinition => ({
    id,
    taxonomy: [],
    name: id,
    description: "",
    event: `event.${id}`,
    configSchema: "[]",
    allowVariants: false,
    createdByType: "MODULE",
    createdByRef: "counter:1.0.0:abc",
    projectionKey: `counter:1.0.0:abc:trigger:${id}`,
    ...overrides,
  });
  const action = (id: string, overrides: Partial<ActionDefinition> = {}): ActionDefinition => ({
    id,
    taxonomy: [],
    name: id,
    description: "",
    call: "",
    type: "",
    paramsSchema: "[]",
    createdByType: "SYSTEM",
    createdByRef: "woofx3",
    ...overrides,
  });
  const labels = new Map([["counter", "Counter"]]);

  test("groups a module's definitions under its display name and the engine's own as built in", () => {
    const catalog = toWorkflowCatalog(
      { triggers: [trigger("increment")], actions: [action("alert")], functions: [] },
      labels,
      "Built-in"
    );
    expect(catalog.triggers[0]).toMatchObject({
      id: "increment",
      moduleId: "counter",
      moduleName: "counter",
      moduleLabel: "Counter",
      canonicalRef: "counter:trigger:increment",
      color: "#888888",
    });
    expect(catalog.actions[0]).toMatchObject({
      id: "alert",
      moduleId: undefined,
      moduleName: undefined,
      moduleLabel: "Built-in",
    });
  });

  test("leaves out webhook triggers, which nothing in the builder binds to", () => {
    const catalog = toWorkflowCatalog(
      {
        triggers: [trigger("by-transport", { transport: "webhook" }), trigger("by-event", { event: "webhook.hit" })],
        actions: [],
        functions: [],
      },
      labels,
      "Built-in"
    );
    expect(catalog.triggers).toEqual([]);
  });

  test("a module the engine no longer lists groups under its id", () => {
    const catalog = toWorkflowCatalog(
      { triggers: [trigger("increment")], actions: [], functions: [] },
      new Map(),
      "Built-in"
    );
    expect(catalog.triggers[0].moduleLabel).toBe("counter");
  });
});

describe("runs", () => {
  const snapshot = {
    id: "run-1",
    workflowId: "w-1",
    status: "completed",
    triggeredBy: "",
    triggerEvent: '{"type":"channel.follow"}',
    error: "",
    startedAt: "2026-10-28T10:00:00Z",
    completedAt: "2026-10-28T10:00:05Z",
    createdAt: "2026-10-28T10:00:00Z",
    updatedAt: "2026-10-28T10:00:05Z",
  };
  const step = (id: string, stepIndex: number, attempt: number) => ({
    id,
    executionId: "run-1",
    taskId: `t-${stepIndex}`,
    status: "completed",
    attempt,
    stepIndex,
    createdAt: "",
    updatedAt: "",
  });

  test("a run's detail lists its steps in the order they ran, retries after the first try", () => {
    const detail: EngineWorkflowRunDetail = {
      run: { ...snapshot, workflowName: "Follow" },
      steps: [step("s-3", 1, 1), step("s-2", 0, 2), step("s-1", 0, 1)],
      alerts: [],
    };
    const mapped = toWorkflowRunDetail(detail, NOW);
    expect(mapped?.steps.map((s) => s.engineStepId)).toEqual(["s-1", "s-2", "s-3"]);
    expect(mapped?.run).toMatchObject({ engineRunId: "run-1", workflowName: "Follow", triggeredBy: undefined });
  });

  test("an unknown run has no detail", () => {
    expect(toWorkflowRunDetail(null, NOW)).toBeNull();
  });

  test("a recorded run says whether it has a trigger event to replay", () => {
    expect(toRecordedWorkflowRun(snapshot).hasTriggerEvent).toBe(true);
    expect(toRecordedWorkflowRun({ ...snapshot, triggerEvent: "" }).hasTriggerEvent).toBe(false);
    expect(toRecordedWorkflowRun(snapshot).dryRun).toBe(false);
  });
});

describe("toWorkflowRun", () => {
  const base = { workflowId: "w-1", executionId: "run-1", occurredAt: "2026-10-28T10:00:00Z" };

  test("a run keeps the start its started event reported when it settles", () => {
    const started = toWorkflowRun({ kind: "started", ...base }, undefined, "Follow");
    const failed = toWorkflowRun(
      { kind: "failed", ...base, occurredAt: "2026-10-28T10:00:05Z", error: "boom" },
      started,
      "Follow"
    );
    expect(started).toMatchObject({ status: "running", completedAt: undefined });
    expect(failed).toMatchObject({
      status: "failed",
      error: "boom",
      startedAt: new Date("2026-10-28T10:00:00Z"),
      completedAt: new Date("2026-10-28T10:00:05Z"),
    });
  });

  test("a run whose start was missed starts when it was first heard of", () => {
    const cancelled = toWorkflowRun({ kind: "cancelled", ...base, reason: "stopped" }, undefined, "w-1");
    expect(cancelled).toMatchObject({ status: "cancelled", error: "stopped", startedAt: new Date(base.occurredAt) });
  });
});

describe("toNotRunning", () => {
  const health = (engineWorkflowId: string, status: "ok" | "error"): ParsedWorkflowHealth => ({
    engineWorkflowId,
    status,
    reason: status === "error" ? "bad trigger" : undefined,
    since: "2026-10-28T10:00:00Z",
    sinceMs: 0,
  });

  test("lists only the errors of enabled workflows", () => {
    const rows = toNotRunning([health("w-1", "error"), health("w-2", "error"), health("w-3", "ok")], new Set(["w-1"]));
    expect(rows).toEqual([{ engineWorkflowId: "w-1", reason: "bad trigger", since: "2026-10-28T10:00:00Z" }]);
  });
});
