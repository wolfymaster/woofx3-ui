import { describe, expect, test } from "bun:test";
import { WORKFLOW_HEALTH_CHANGED_EVENT_TYPE } from "@shared/workflow-health";
import { WORKFLOW_RUN_CANCELLED_EVENT_TYPE } from "@shared/workflow-test-run";
import { EngineEventType } from "@woofx3/api/webhooks";
import { internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { SESSION_SUMMARY_EVENT_TYPE } from "./lib/sessionSummary";

const SECRET = "webhook-secret";
const NOW = "2026-11-04T10:00:00.000Z";

type Backend = ReturnType<typeof newBackend>;

async function backendWithInstance(): Promise<Backend> {
  const t = newBackend();
  await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
      webhookSecret: SECRET,
    });
  });
  return t;
}

let envelopeSeq = 0;
function envelope(data: Record<string, unknown>) {
  envelopeSeq++;
  return { specversion: "1.0", id: `env-${envelopeSeq}`, source: "engine", type: data.type, time: NOW, data };
}

async function apply(t: Backend, data: Record<string, unknown>) {
  return t.mutation(internal.engineEvents.applyFromWebhook, {
    webhookSecret: SECRET,
    body: JSON.stringify(envelope(data)),
  });
}

async function count(t: Backend, table: TableNames): Promise<number> {
  return t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
}

const scene = {
  id: "scene-1",
  name: "Main scene",
  description: "",
  widgetsJson: "[]",
  layoutJson: "{}",
  createdByType: "USER",
  createdByRef: "user",
  createdAt: NOW,
  updatedAt: NOW,
};
const command = {
  id: "cmd-1",
  command: "!hi",
  actions: [],
  cooldown: 0,
  priority: 0,
  enabled: true,
  visibility: "public",
};
const group = { id: "grp-1", name: "Mods", description: "", isBuiltIn: false, createdAt: NOW };
const run = { id: "run-1", workflowId: "wf-1", status: "running", createdAt: NOW, updatedAt: NOW };
const step = {
  id: "step-1",
  executionId: "run-1",
  taskId: "t1",
  status: "completed",
  attempt: 1,
  stepIndex: 0,
  createdAt: NOW,
  updatedAt: NOW,
};
const fn = { id: "fn-1", name: "greet", fileName: "greet.lua" };
const asset = {
  id: "asset-1",
  canonicalId: "mod:asset-1",
  projectionKey: "mod:asset-1",
  manifestId: "asset-1",
  name: "Logo",
  repositoryKey: "mod/logo.png",
  manifestPath: "assets/logo.png",
  createdByType: "MODULE",
  createdByRef: "mod",
};
const resourceInstance = {
  id: "ri-1",
  moduleId: "module-uuid",
  moduleName: "mod",
  kind: "counter",
  instanceId: "deaths",
  displayName: "Deaths",
  canonicalId: "mod:counter:deaths",
  moduleKey: "mod:1.0.0",
};
const installed = {
  type: EngineEventType.MODULE_INSTALLED,
  moduleKey: "mod:1.0.0",
  moduleName: "mod",
  version: "1.0.0",
};
const trigger = { id: "trg-1", name: "Follow", canonicalId: "mod:trigger:follow" };
const action = { id: "act-1", name: "Say", canonicalId: "mod:action:say" };
const widget = { projectionKey: "mod:widget-1", name: "Ticker", directory: "ticker", settings: [], alertTypes: [] };

/**
 * One case per event type the dispatch applies: the events to send, in order,
 * and the table whose row count the last one leaves behind.
 */
const PARITY_CASES: { name: string; events: Record<string, unknown>[]; table: TableNames; rows: number }[] = [
  {
    name: "workflow.created",
    events: [{ type: EngineEventType.WORKFLOW_CREATED, workflow: { id: "wf-1", definition: {}, isEnabled: true } }],
    table: "workflows",
    rows: 1,
  },
  {
    name: "workflow.deleted",
    events: [
      { type: EngineEventType.WORKFLOW_CREATED, workflow: { id: "wf-1", definition: {}, isEnabled: true } },
      { type: EngineEventType.WORKFLOW_DELETED, workflowId: "wf-1" },
    ],
    table: "workflows",
    rows: 0,
  },
  { name: "scene.created", events: [{ type: EngineEventType.SCENE_CREATED, scene }], table: "scenes", rows: 1 },
  { name: "scene.updated", events: [{ type: EngineEventType.SCENE_UPDATED, scene }], table: "scenes", rows: 1 },
  {
    name: "scene.deleted",
    events: [
      { type: EngineEventType.SCENE_CREATED, scene },
      { type: EngineEventType.SCENE_DELETED, sceneId: "scene-1" },
    ],
    table: "scenes",
    rows: 0,
  },
  {
    name: "command.created",
    events: [{ type: EngineEventType.COMMAND_CREATED, command }],
    table: "chatCommands",
    rows: 1,
  },
  {
    name: "command.deleted",
    events: [
      { type: EngineEventType.COMMAND_CREATED, command },
      { type: EngineEventType.COMMAND_DELETED, commandId: "cmd-1" },
    ],
    table: "chatCommands",
    rows: 0,
  },
  {
    name: "group.created",
    events: [{ type: EngineEventType.GROUP_CREATED, group }],
    table: "chatCommandGroups",
    rows: 1,
  },
  {
    name: "group.deleted",
    events: [
      { type: EngineEventType.GROUP_CREATED, group },
      { type: EngineEventType.GROUP_DELETED, groupId: "grp-1" },
    ],
    table: "chatCommandGroups",
    rows: 0,
  },
  {
    name: "group.member.added",
    events: [
      { type: EngineEventType.GROUP_CREATED, group },
      { type: EngineEventType.GROUP_MEMBER_ADDED, groupId: "grp-1", username: "viewer" },
    ],
    table: "chatCommandGroupMembers",
    rows: 1,
  },
  {
    name: "group.member.removed",
    events: [
      { type: EngineEventType.GROUP_CREATED, group },
      { type: EngineEventType.GROUP_MEMBER_ADDED, groupId: "grp-1", username: "viewer" },
      { type: EngineEventType.GROUP_MEMBER_REMOVED, groupId: "grp-1", username: "viewer" },
    ],
    table: "chatCommandGroupMembers",
    rows: 0,
  },
  {
    name: "workflow.run.recorded",
    events: [{ type: EngineEventType.WORKFLOW_RUN_RECORDED, run }],
    table: "workflowRuns",
    rows: 1,
  },
  {
    name: "workflow.run.updated",
    events: [
      { type: EngineEventType.WORKFLOW_RUN_RECORDED, run },
      { type: EngineEventType.WORKFLOW_RUN_UPDATED, run: { ...run, status: "completed" } },
    ],
    table: "workflowRuns",
    rows: 1,
  },
  {
    name: "workflow.run.step.recorded",
    events: [
      { type: EngineEventType.WORKFLOW_RUN_RECORDED, run },
      { type: EngineEventType.WORKFLOW_RUN_STEP_RECORDED, step },
    ],
    table: "workflowRunSteps",
    rows: 1,
  },
  {
    name: "workflow.run.started",
    events: [{ type: EngineEventType.WORKFLOW_RUN_STARTED, triggerId: "trig-1", runId: "run-1", workflowId: "wf-1" }],
    table: "transientEvents",
    rows: 1,
  },
  {
    name: "workflow.run.cancelled",
    events: [{ type: WORKFLOW_RUN_CANCELLED_EVENT_TYPE, triggerId: "trig-1", runId: "run-1", workflowId: "wf-1" }],
    table: "transientEvents",
    rows: 1,
  },
  {
    name: "engine.response.received",
    events: [{ type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey: "c-1", status: "success" }],
    table: "transientEvents",
    rows: 1,
  },
  {
    name: "module.storage.changed",
    events: [{ type: EngineEventType.MODULE_STORAGE_CHANGED, moduleId: "mod", key: "deaths", value: 3 }],
    table: "transientEvents",
    rows: 1,
  },
  {
    name: "module.widget.status.changed",
    events: [{ type: EngineEventType.WIDGET_STATUS_CHANGED, moduleId: "mod", instanceId: "i", key: "k", status: "ok" }],
    table: "transientEvents",
    rows: 1,
  },
  {
    name: "alert.recorded",
    events: [{ type: EngineEventType.ALERT_RECORDED, alert: { id: "alert-1", status: "queued" } }],
    table: "engineAlerts",
    rows: 1,
  },
  {
    name: "module.function.registered",
    events: [
      installed,
      {
        type: EngineEventType.MODULE_FUNCTION_REGISTERED,
        moduleKey: "mod:1.0.0",
        moduleName: "mod",
        version: "1.0.0",
        functions: [fn],
      },
    ],
    table: "moduleFunctions",
    rows: 1,
  },
  {
    name: "module.function.deregistered",
    events: [
      installed,
      {
        type: EngineEventType.MODULE_FUNCTION_REGISTERED,
        moduleKey: "mod:1.0.0",
        moduleName: "mod",
        version: "1.0.0",
        functions: [fn],
      },
      { type: EngineEventType.MODULE_FUNCTION_DEREGISTERED, functions: [fn] },
    ],
    table: "moduleFunctions",
    rows: 0,
  },
  {
    name: "module.asset.registered",
    events: [
      installed,
      {
        type: EngineEventType.MODULE_ASSET_REGISTERED,
        moduleKey: "mod:1.0.0",
        moduleName: "mod",
        version: "1.0.0",
        assets: [asset],
      },
    ],
    table: "moduleAssets",
    rows: 1,
  },
  {
    name: "module.asset.deregistered",
    events: [
      installed,
      {
        type: EngineEventType.MODULE_ASSET_REGISTERED,
        moduleKey: "mod:1.0.0",
        moduleName: "mod",
        version: "1.0.0",
        assets: [asset],
      },
      {
        type: EngineEventType.MODULE_ASSET_DEREGISTERED,
        moduleKey: "mod:1.0.0",
        moduleName: "mod",
        version: "1.0.0",
        assets: [asset],
      },
    ],
    table: "moduleAssets",
    rows: 0,
  },
  {
    name: "module.resource.instance.created",
    events: [installed, { type: EngineEventType.MODULE_RESOURCE_INSTANCE_CREATED, instance: resourceInstance }],
    table: "moduleResourceInstances",
    rows: 1,
  },
  {
    name: "module.resource.instance.deleted",
    events: [
      installed,
      { type: EngineEventType.MODULE_RESOURCE_INSTANCE_CREATED, instance: resourceInstance },
      { type: EngineEventType.MODULE_RESOURCE_INSTANCE_DELETED, instance: resourceInstance },
    ],
    table: "moduleResourceInstances",
    rows: 0,
  },
  {
    name: "module.widget.registered",
    events: [{ type: EngineEventType.MODULE_WIDGET_REGISTERED, widgets: [widget] }],
    table: "instanceWidgets",
    rows: 1,
  },
  {
    name: "module.widget.deregistered",
    events: [
      { type: EngineEventType.MODULE_WIDGET_REGISTERED, widgets: [widget] },
      { type: EngineEventType.MODULE_WIDGET_DEREGISTERED, widgets: [widget] },
    ],
    table: "instanceWidgets",
    rows: 0,
  },
  {
    name: "stream.online",
    events: [{ type: EngineEventType.STREAM_ONLINE, twitchUserId: "123", startedAt: NOW }],
    table: "instanceLiveState",
    rows: 1,
  },
  {
    name: "session.started",
    events: [{ type: EngineEventType.SESSION_STARTED, sessionId: "s-1", startedAt: NOW }],
    table: "instanceLiveState",
    rows: 1,
  },
  { name: "module.installed", events: [installed], table: "moduleRepository", rows: 1 },
  {
    name: "module.install_failed",
    events: [installed, { ...installed, type: EngineEventType.MODULE_INSTALL_FAILED, error: "boom" }],
    table: "moduleRepository",
    rows: 1,
  },
  {
    name: "module.deleted",
    events: [installed, { type: EngineEventType.MODULE_DELETED, moduleKey: "mod:1.0.0", moduleName: "mod" }],
    table: "moduleRepository",
    rows: 0,
  },
  {
    name: "module.delete_failed",
    events: [
      installed,
      { type: EngineEventType.MODULE_DELETE_FAILED, moduleKey: "mod:1.0.0", moduleName: "mod", error: "in use" },
    ],
    table: "moduleRepository",
    rows: 1,
  },
  {
    name: "module.trigger.registered",
    events: [
      installed,
      { type: EngineEventType.MODULE_TRIGGER_REGISTERED, moduleName: "mod", version: "1.0.0", triggers: [trigger] },
    ],
    table: "triggerDefinitions",
    rows: 1,
  },
  {
    name: "module.trigger.deregistered",
    events: [
      installed,
      { type: EngineEventType.MODULE_TRIGGER_REGISTERED, moduleName: "mod", version: "1.0.0", triggers: [trigger] },
      { type: EngineEventType.MODULE_TRIGGER_DEREGISTERED, triggers: [trigger] },
    ],
    table: "triggerDefinitions",
    rows: 0,
  },
  {
    name: "module.action.registered",
    events: [
      installed,
      { type: EngineEventType.MODULE_ACTION_REGISTERED, moduleName: "mod", version: "1.0.0", actions: [action] },
    ],
    table: "actionDefinitions",
    rows: 1,
  },
  {
    name: "module.action.deregistered",
    events: [
      installed,
      { type: EngineEventType.MODULE_ACTION_REGISTERED, moduleName: "mod", version: "1.0.0", actions: [action] },
      { type: EngineEventType.MODULE_ACTION_DEREGISTERED, actions: [action] },
    ],
    table: "actionDefinitions",
    rows: 0,
  },
  {
    name: "stream.offline",
    events: [
      { type: EngineEventType.STREAM_ONLINE, twitchUserId: "123", startedAt: NOW },
      { type: EngineEventType.STREAM_OFFLINE, twitchUserId: "123" },
    ],
    table: "instanceLiveState",
    rows: 1,
  },
  {
    name: "overlay.token.revoked",
    events: [{ type: EngineEventType.OVERLAY_TOKEN_REVOKED, tokenId: "tok-1" }],
    table: "browserSourceKeys",
    rows: 0,
  },
];

describe("applyFromWebhook", () => {
  for (const testCase of PARITY_CASES) {
    test(`applies ${testCase.name}`, async () => {
      const t = await backendWithInstance();
      for (const data of testCase.events) {
        expect(await apply(t, data)).toEqual({ kind: "applied" });
      }
      expect(await count(t, testCase.table)).toBe(testCase.rows);
      expect(await count(t, "engineEventLog")).toBe(testCase.events.length);
    });
  }

  test("an unknown type is ignored but still logged", async () => {
    const t = await backendWithInstance();
    expect(await apply(t, { type: "something.new" })).toEqual({ kind: "ignored" });
    expect(await count(t, "engineEventLog")).toBe(1);
  });

  test("an invalid session summary is invalid", async () => {
    const t = await backendWithInstance();
    const result = await apply(t, { type: SESSION_SUMMARY_EVENT_TYPE });
    expect(result.kind).toBe("invalid");
    expect(await count(t, "streamSessionSummaries")).toBe(0);
  });

  test("an alert snapshot without an id is invalid", async () => {
    const t = await backendWithInstance();
    const result = await apply(t, { type: EngineEventType.ALERT_RECORDED, alert: { status: "queued" } });
    expect(result).toEqual({ kind: "invalid", reason: "Alert callback needs an alert with an id and a status" });
    expect(await count(t, "engineAlerts")).toBe(0);
  });

  test("invalid workflow health is invalid", async () => {
    const t = await backendWithInstance();
    expect((await apply(t, { type: WORKFLOW_HEALTH_CHANGED_EVENT_TYPE })).kind).toBe("invalid");
  });

  test("an unknown secret is unauthorized and writes nothing", async () => {
    const t = await backendWithInstance();
    const result = await t.mutation(internal.engineEvents.applyFromWebhook, {
      webhookSecret: "wrong",
      body: JSON.stringify(envelope({ type: EngineEventType.SCENE_CREATED, scene })),
    });
    expect(result).toEqual({ kind: "unauthorized" });
    expect(await count(t, "engineEventLog")).toBe(0);
    expect(await count(t, "scenes")).toBe(0);
  });

  test("$-prefixed keys are escaped before they are stored", async () => {
    const t = await backendWithInstance();
    const definition = { steps: [{ $ref: "x" }] };
    await apply(t, { type: EngineEventType.WORKFLOW_CREATED, workflow: { id: "wf-1", definition, isEnabled: true } });
    const [log] = await t.run((ctx) => ctx.db.query("engineEventLog").collect());
    expect(log.payload).toContain('"$ref"');
  });
});

describe("POST /api/webhooks/woofx3", () => {
  async function post(t: Backend, data: Record<string, unknown>, secret = SECRET) {
    return t.fetch("/api/webhooks/woofx3", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(envelope(data)),
    });
  }

  test("an applied event answers 200", async () => {
    const t = await backendWithInstance();
    const response = await post(t, { type: EngineEventType.SCENE_CREATED, scene });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, type: EngineEventType.SCENE_CREATED });
  });

  test("an ignored event answers handled: false", async () => {
    const t = await backendWithInstance();
    const response = await post(t, { type: "something.new" });
    expect(await response.json()).toEqual({ success: true, type: "something.new", handled: false });
  });

  test("an invalid alert snapshot keeps answering 400", async () => {
    const t = await backendWithInstance();
    const response = await post(t, { type: EngineEventType.ALERT_RECORDED, alert: {} });
    expect(response.status).toBe(400);
  });

  test("an invalid session summary keeps answering 400", async () => {
    const t = await backendWithInstance();
    const response = await post(t, { type: SESSION_SUMMARY_EVENT_TYPE });
    expect(response.status).toBe(400);
  });

  test("an unknown secret answers 401", async () => {
    const t = await backendWithInstance();
    const response = await post(t, { type: EngineEventType.SCENE_CREATED, scene }, "wrong");
    expect(response.status).toBe(401);
  });
});
