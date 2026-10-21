import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InstanceId } from "@/engine/types";

// Each read answers with a Convex row, so these check what the gateway hands
// callers instead: the engine-neutral record, with Convex's own fields gone
// and its ids converted.

let rows: Record<string, unknown> = {};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useQuery: (query: Parameters<typeof getFunctionName>[0]) => rows[getFunctionName(query)],
}));

const { convexAlertQueueGateway } = await import("./alert-queue");
const { convexModuleResourcesGateway } = await import("./module-resources");
const { convexScenesGateway } = await import("./scenes");
const { convexStatusGateway } = await import("./status");
const { convexWorkflowsGateway } = await import("./workflows");

function read<T>(hook: () => T): T {
  let value: { current: T } | undefined;
  function Probe() {
    value = { current: hook() };
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!value) {
    throw new Error("the probe did not render");
  }
  return value.current;
}

const instanceId = "instance-1" as InstanceId;
const convexFields = { _creationTime: 1_700_000_000_000, instanceId: "instance-1" };

beforeEach(() => {
  rows = {};
});

describe("Convex rows become engine-neutral records", () => {
  test("a scene keeps its id and loses Convex's fields", () => {
    rows["scenes:list"] = [
      { _id: "scene-1", id: "scene-1", ...convexFields, name: "Main", widgets: [], createdAt: 5, updatedAt: 6 },
    ];
    expect(read(() => convexScenesGateway.useScenes(instanceId))).toEqual([
      { id: "scene-1", name: "Main", widgets: [], createdAt: 5, updatedAt: 6 },
    ]);
  });

  test("an alert keeps its record id for keys", () => {
    rows["engineAlerts:listForInstance"] = [
      { _id: "row-1", ...convexFields, engineAlertId: "alert-1", status: "completed", createdAt: 7 },
    ];
    expect(read(() => convexAlertQueueGateway.useAlerts(instanceId, 10))).toEqual([
      { id: "row-1", engineAlertId: "alert-1", status: "completed", createdAt: 7 },
    ]);
  });

  test("a resource instance carries its module as a gateway id", () => {
    rows["moduleResourceInstances:listForInstance"] = [
      {
        _id: "row-1",
        ...convexFields,
        moduleId: "module-row-1",
        canonicalId: "obs:counter:deaths",
        engineInstanceId: "engine-1",
        resourceInstanceId: "deaths",
        kind: "counter",
        moduleName: "obs",
        displayName: "Deaths",
      },
    ];
    expect(read(() => convexModuleResourcesGateway.useInstances(instanceId))).toEqual([
      {
        moduleId: "module-row-1",
        canonicalId: "obs:counter:deaths",
        engineInstanceId: "engine-1",
        resourceInstanceId: "deaths",
        kind: "counter",
        moduleName: "obs",
        displayName: "Deaths",
      },
    ] as unknown as ReturnType<typeof convexModuleResourcesGateway.useInstances>);
  });

  test("sync runs keep their id and the schedule loses Convex's fields", () => {
    const run = { _id: "run-1", ...convexFields, trigger: "manual", status: "success", startedAt: 1, steps: [] };
    rows["engineSync:getSyncState"] = {
      syncState: { _id: "sync-1", ...convexFields, status: "idle", nextEligibleAt: 2 },
      currentRun: null,
      recentRuns: [run],
    };
    expect(read(() => convexStatusGateway.useSyncState(instanceId))).toEqual({
      syncState: { status: "idle", nextEligibleAt: 2 },
      currentRun: null,
      recentRuns: [{ id: "run-1", trigger: "manual", status: "success", startedAt: 1, steps: [] }],
    } as unknown as ReturnType<typeof convexStatusGateway.useSyncState>);
  });

  test("a recorded run and its steps lose Convex's fields", () => {
    rows["workflowRuns:runWithSteps"] = {
      run: { _id: "run-row", ...convexFields, engineRunId: "run-1", workflowName: "Raid", status: "completed" },
      steps: [{ _id: "step-row", ...convexFields, engineStepId: "step-1", stepIndex: 0 }],
      alerts: [],
    };
    expect(read(() => convexWorkflowsGateway.useRun(instanceId, "run-1"))).toEqual({
      run: { engineRunId: "run-1", workflowName: "Raid", status: "completed" },
      steps: [{ engineStepId: "step-1", stepIndex: 0 }],
      alerts: [],
    } as unknown as ReturnType<typeof convexWorkflowsGateway.useRun>);
  });

  test("loading and missing reads pass through", () => {
    expect(read(() => convexWorkflowsGateway.useWorkflows(instanceId))).toBeUndefined();
    rows["workflows:getByEngineId"] = null;
    expect(read(() => convexWorkflowsGateway.useWorkflow(instanceId, "wf-1"))).toBeNull();
  });
});
