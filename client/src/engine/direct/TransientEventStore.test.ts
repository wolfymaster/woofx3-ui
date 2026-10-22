import { describe, expect, test } from "bun:test";
import { type CallbackEvent, EngineEventType, makeCallbackEnvelope } from "@woofx3/api";
import { FakeClock } from "@/lib/engine-session/testing/FakeClock";
import { RecordingLogger } from "@/lib/engine-session/testing/RecordingLogger";
import { TransientEventStore, transientOf } from "./TransientEventStore";

const AT = "2026-10-21T12:00:00.000Z";

function envelope(event: CallbackEvent, id = "env-1") {
  return makeCallbackEnvelope(event, "engine", id, AT);
}

const run = { workflowId: "wf-1", executionId: "ex-1", triggeredBy: "dashboard", occurredAt: AT };

describe("transientOf", () => {
  const cases: Array<{ name: string; event: CallbackEvent; expected: unknown }> = [
    {
      name: "an engine response, under its correlation key",
      event: { type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey: "c-1", status: "error", error: "nope" },
      expected: { correlationKey: "c-1", type: "engine.response", status: "error", message: "nope", data: undefined },
    },
    {
      name: "a started run somebody waits on, as progress",
      event: { type: EngineEventType.WORKFLOW_RUN_STARTED, triggerId: "t-1", ...run },
      expected: {
        correlationKey: "t-1",
        type: "workflow.run.started",
        status: "progress",
        message: undefined,
        data: run,
      },
    },
    {
      name: "a failed run, with the engine's reason",
      event: { type: EngineEventType.WORKFLOW_RUN_FAILED, triggerId: "t-1", error: "boom", ...run },
      expected: { correlationKey: "t-1", type: "workflow.run.failed", status: "error", message: "boom", data: run },
    },
    {
      name: "a cancelled run, as an error with its reason",
      event: { type: EngineEventType.WORKFLOW_RUN_CANCELLED, triggerId: "t-1", reason: "cancelled: stop", ...run },
      expected: {
        correlationKey: "t-1",
        type: "workflow.run.cancelled",
        status: "error",
        message: "cancelled: stop",
        data: run,
      },
    },
    {
      name: "no event for a run nobody waits on",
      event: { type: EngineEventType.WORKFLOW_RUN_COMPLETED, ...run },
      expected: null,
    },
    {
      name: "an install, under the module key",
      event: {
        type: EngineEventType.MODULE_INSTALLED,
        modulePrefix: "obs",
        moduleName: "obs",
        version: "1.0.0",
        moduleKey: "obs:1.0.0",
      },
      expected: {
        correlationKey: "obs:1.0.0",
        type: "module.install",
        status: "success",
        message: "Module obs@1.0.0 installed successfully.",
      },
    },
    {
      name: "a failed install with no error text, with the fallback message",
      event: {
        type: EngineEventType.MODULE_INSTALL_FAILED,
        modulePrefix: "obs",
        moduleName: "obs",
        version: "1.0.0",
        moduleKey: "obs:1.0.0",
        error: "",
      },
      expected: {
        correlationKey: "obs:1.0.0",
        type: "module.install",
        status: "error",
        message: "Module installation failed on the engine.",
        data: { moduleName: "obs", moduleVersion: "1.0.0" },
      },
    },
    {
      name: "a refused uninstall, with the resources still in use",
      event: {
        type: EngineEventType.MODULE_DELETE_FAILED,
        modulePrefix: "obs",
        moduleName: "obs",
        moduleKey: "obs:1.0.0",
        error: "in use",
        inUseResources: [],
      },
      expected: {
        correlationKey: "obs:1.0.0",
        type: "module.uninstall",
        status: "error",
        message: "in use",
        data: { moduleName: "obs", conflicts: [] },
      },
    },
    {
      name: "a widget status without a canonical id, under module, instance and key",
      event: {
        type: EngineEventType.WIDGET_STATUS_CHANGED,
        moduleId: "m-1",
        instanceId: "w-1",
        key: "count",
        value: 3,
        occurredAt: AT,
      },
      expected: {
        correlationKey: "m-1:w-1:count",
        type: "widget.status.changed",
        status: "success",
        data: {
          moduleId: "m-1",
          widgetInstanceId: "w-1",
          widgetCanonicalId: undefined,
          key: "count",
          value: 3,
          occurredAt: AT,
        },
      },
    },
    {
      name: "nothing for an event no caller follows",
      event: { type: EngineEventType.GROUP_DELETED, groupId: "g-1" },
      expected: null,
    },
  ];

  for (const { name, event, expected } of cases) {
    test(name, () => {
      expect(transientOf(envelope(event))).toEqual(expected as never);
    });
  }
});

describe("TransientEventStore", () => {
  const response = (correlationKey: string, id: string) =>
    envelope({ type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey, status: "success" }, id);

  test("keeps events by key, oldest first, until they expire", () => {
    const clock = new FakeClock();
    const store = new TransientEventStore(clock, new RecordingLogger(), { ttlMs: 1_000, perKey: 10 });
    store.ingest(response("k", "a"));
    clock.advance(600);
    store.ingest(response("k", "b"));
    expect(store.events("k").map((event) => event.expiresAt - clock.now())).toEqual([400, 1_000]);
    clock.advance(500);
    expect(store.events("k")).toHaveLength(1);
    clock.advance(500);
    expect(store.latest("k")).toBeNull();
    expect(store.events("missing")).toEqual([]);
  });

  test("keeps at most perKey events under one key, dropping the oldest", () => {
    const store = new TransientEventStore(new FakeClock(), new RecordingLogger(), { ttlMs: 1_000, perKey: 2 });
    for (const id of ["a", "b", "c"]) {
      store.ingest(response("k", id));
    }
    expect(store.events("k")).toHaveLength(2);
  });

  test("reads the same snapshot until something changes, and tells subscribers", () => {
    const store = new TransientEventStore(new FakeClock(), new RecordingLogger(), { ttlMs: 1_000, perKey: 10 });
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.ingest(response("k", "a"));
    expect(store.events("k")).toBe(store.events("k"));
    store.ingest(envelope({ type: EngineEventType.GROUP_DELETED, groupId: "g" }));
    store.clear();
    expect(notified).toBe(2);
    expect(store.latest("k")).toBeNull();
  });
});
