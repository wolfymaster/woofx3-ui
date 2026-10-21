import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { InstanceId } from "@/engine/types";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// Each read answers with a Convex row, so these check what the gateway hands
// callers instead: the engine-neutral record, with Convex's own fields gone
// and its ids converted.

let rows: Record<string, unknown> = {};
let pages: Record<string, unknown[]> = {};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useQuery: (query: Parameters<typeof getFunctionName>[0]) => rows[getFunctionName(query)],
  usePaginatedQuery: (query: Parameters<typeof getFunctionName>[0]) => ({
    results: pages[getFunctionName(query)] ?? [],
    status: "Exhausted",
    isLoading: false,
    loadMore: () => undefined,
  }),
}));

const { convexAlertLibraryGateway } = await import("./alert-library");
const { convexAlertQueueGateway } = await import("./alert-queue");
const { convexCommandsGateway } = await import("./commands");
const { convexEventLogGateway } = await import("./event-log");
const { convexModuleResourcesGateway } = await import("./module-resources");
const { convexRequestsGateway } = await import("./requests");
const { convexScenesGateway } = await import("./scenes");
const { convexStatusGateway } = await import("./status");
const { convexWorkflowsGateway } = await import("./workflows");

const instanceId = TEST_INSTANCE_ID;
const convexFields = { _creationTime: 1_700_000_000_000, instanceId: "instance-1" };

beforeEach(() => {
  rows = {};
  pages = {};
});

/** Every key a mapped value carries, at any depth, that only Convex would put there. */
function convexKeysIn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(convexKeysIn);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, inner]) => [
    ...(key.startsWith("_") || key === "instanceId" ? [key] : []),
    ...convexKeysIn(inner),
  ]);
}

describe("Convex rows become engine-neutral records", () => {
  test("a scene keeps its id and loses Convex's fields", () => {
    rows["scenes:list"] = [
      { _id: "scene-1", id: "scene-1", ...convexFields, name: "Main", widgets: [], createdAt: 5, updatedAt: 6 },
    ];
    expect(renderInScope(() => convexScenesGateway.useScenes())).toEqual([
      { id: "scene-1", name: "Main", widgets: [], createdAt: 5, updatedAt: 6 },
    ]);
  });

  test("an alert keeps its record id for keys", () => {
    rows["engineAlerts:listForInstance"] = [
      { _id: "row-1", ...convexFields, engineAlertId: "alert-1", status: "completed", createdAt: 7 },
    ];
    expect(renderInScope(() => convexAlertQueueGateway.useAlerts(10))).toEqual([
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
    expect(renderInScope(() => convexModuleResourcesGateway.useInstances())).toEqual([
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
    expect(renderInScope(() => convexStatusGateway.useSyncState())).toEqual({
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
    expect(renderInScope(() => convexWorkflowsGateway.useRun("run-1"))).toEqual({
      run: { engineRunId: "run-1", workflowName: "Raid", status: "completed" },
      steps: [{ engineStepId: "step-1", stepIndex: 0 }],
      alerts: [],
    } as unknown as ReturnType<typeof convexWorkflowsGateway.useRun>);
  });

  test("loading and missing reads pass through", () => {
    expect(renderInScope(() => convexWorkflowsGateway.useWorkflows())).toBeUndefined();
    rows["workflows:getByEngineId"] = null;
    expect(renderInScope(() => convexWorkflowsGateway.useWorkflow("wf-1"))).toBeNull();
  });
});

interface MappingCase {
  name: string;
  /** The Convex function the read subscribes to, and what it answers. */
  query: string;
  answer: unknown;
  paginated?: boolean;
  read: () => unknown;
  expected: unknown;
}

const catalogTrigger = {
  id: "twitch.follow",
  name: "Follow",
  description: "Someone followed",
  category: "Twitch",
  color: "purple",
  icon: "heart",
  event: "follow",
  moduleId: "module-row-1",
  moduleName: "twitch",
  moduleLabel: "Twitch",
};

const catalogAction = {
  id: "obs.scene",
  name: "Switch scene",
  description: "Shows a scene",
  category: "OBS",
  color: "blue",
  icon: "monitor",
  moduleId: undefined,
  moduleName: undefined,
  moduleLabel: "Built in",
};

const MAPPING_CASES: MappingCase[] = [
  {
    name: "a chat command loses Convex's fields",
    query: "chatCommands:list",
    answer: [
      {
        _id: "row-1",
        ...convexFields,
        engineCommandId: "cmd-1",
        command: "lurk",
        actions: [],
        cooldown: 5,
        priority: 0,
        enabled: true,
        visibility: "public",
        groupIds: [],
        usernames: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    read: () => convexCommandsGateway.useCommands(),
    expected: [
      {
        engineCommandId: "cmd-1",
        command: "lurk",
        actions: [],
        cooldown: 5,
        priority: 0,
        enabled: true,
        visibility: "public",
        groupIds: [],
        usernames: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  },
  {
    name: "a chat command group loses Convex's fields",
    query: "chatCommandGroups:list",
    answer: [
      {
        _id: "row-1",
        ...convexFields,
        engineGroupId: "group-1",
        name: "Mods",
        description: "",
        isBuiltIn: true,
        engineCreatedAt: "2026-01-01T00:00:00Z",
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    read: () => convexCommandsGateway.useGroups(),
    expected: [
      {
        engineGroupId: "group-1",
        name: "Mods",
        description: "",
        isBuiltIn: true,
        engineCreatedAt: "2026-01-01T00:00:00Z",
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  },
  {
    name: "a catalog entry carries its module as a gateway id, or none",
    query: "workflowCatalog:get",
    answer: { triggers: [catalogTrigger], actions: [catalogAction] },
    read: () => convexWorkflowsGateway.useCatalog(),
    expected: { triggers: [catalogTrigger], actions: [catalogAction] },
  },
  {
    name: "a scene widget loses Convex's fields and carries its module as a gateway id",
    query: "sceneWidgets:listForInstance",
    answer: [
      {
        _id: "widget-row-1",
        _creationTime: 1,
        widgetId: "alert-box",
        name: "Alert box",
        moduleId: "module-row-1",
        moduleName: "alerts",
        directory: "widgets/alert-box",
        alertTypes: ["follow"],
        settings: [],
        createdAt: 3,
      },
    ],
    read: () => convexScenesGateway.useWidgetCatalog(),
    expected: [
      {
        widgetId: "alert-box",
        name: "Alert box",
        moduleId: "module-row-1",
        moduleName: "alerts",
        directory: "widgets/alert-box",
        alertTypes: ["follow"],
        settings: [],
        createdAt: 3,
      },
    ],
  },
  {
    name: "a logged webhook event keeps its record id as a gateway id",
    query: "engineEventLog:list",
    paginated: true,
    answer: [
      {
        _id: "log-row-1",
        _creationTime: 1,
        eventType: "follow",
        source: "webhook",
        receivedAt: 4,
        payloadLength: 120,
      },
    ],
    read: () => convexEventLogGateway.useWebhookEvents(null, 10).results,
    expected: [{ id: "log-row-1", eventType: "follow", source: "webhook", receivedAt: 4, payloadLength: 120 }],
  },
  {
    name: "a library alert loses Convex's fields and keeps its stored shapes",
    query: "alertCompositions:list",
    answer: [
      {
        _id: "composition-row-1",
        ...convexFields,
        engineCompositionId: "composition-1",
        name: "Follow",
        widgets: [{ id: "w1" }],
        layout: { width: 1920 },
        behaviors: { enter: "fade" },
        inputs: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    read: () => convexAlertLibraryGateway.useAlerts(),
    expected: [
      {
        engineCompositionId: "composition-1",
        name: "Follow",
        widgets: [{ id: "w1" }],
        layout: { width: 1920 },
        behaviors: { enter: "fade" },
        inputs: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  },
  {
    name: "a transient event loses Convex's fields",
    query: "transientEvents:get",
    answer: {
      _id: "event-row-1",
      ...convexFields,
      correlationKey: "key-1",
      type: "module.install",
      status: "success",
      data: { moduleKey: "obs" },
      expiresAt: 9,
    },
    read: () => convexRequestsGateway.useEvent("key-1"),
    expected: {
      correlationKey: "key-1",
      type: "module.install",
      status: "success",
      data: { moduleKey: "obs" },
      expiresAt: 9,
    },
  },
  {
    name: "a missing transient event passes through as null",
    query: "transientEvents:get",
    answer: null,
    read: () => convexRequestsGateway.useEvent("key-1"),
    expected: null,
  },
];

describe("each mapper builds its domain record from named fields", () => {
  for (const mappingCase of MAPPING_CASES) {
    test(mappingCase.name, () => {
      if (mappingCase.paginated) {
        pages[mappingCase.query] = mappingCase.answer as unknown[];
      } else {
        rows[mappingCase.query] = mappingCase.answer;
      }
      const mapped = renderInScope(mappingCase.read);
      expect(mapped).toEqual(mappingCase.expected);
      expect(convexKeysIn(mapped)).toEqual([]);
    });
  }

  test("a column the domain type does not name stays behind", () => {
    rows["chatCommandGroups:list"] = [
      {
        _id: "row-1",
        ...convexFields,
        engineGroupId: "group-1",
        name: "Mods",
        description: "",
        engineCreatedAt: "2026-01-01T00:00:00Z",
        createdAt: 1,
        updatedAt: 2,
        internalNote: "cloud only",
      },
    ];
    const [group] = renderInScope(() => convexCommandsGateway.useGroups()) ?? [];
    expect(group).not.toHaveProperty("internalNote");
  });
});
