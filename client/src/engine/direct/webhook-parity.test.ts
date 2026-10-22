import { describe, expect, test } from "bun:test";
import {
  engineResponseTransient,
  moduleDeleteFailedTransient,
  moduleInstalledTransient,
  moduleInstallFailedTransient,
  moduleRemovedTransient,
  runLifecycleTransient,
  storageChangedTransient,
  type WebhookTransient,
  widgetStatusTransient,
} from "@convex/lib/webhookTransients";
import { type CallbackEvent, EngineEventType, makeCallbackEnvelope } from "@woofx3/api/webhooks";
import { transientOf } from "./TransientEventStore";

// The direct gateway projects transient events from the engine event stream
// itself, since its code may not import Convex. These fixtures run through
// both projections so the two cannot drift: a screen following a correlation
// key must read the same events under either gateway. This is the one file
// of the direct adapter the boundary test lets import Convex.

/** What the webhook writes for `event`, with the arguments convex/http.ts passes for it. */
function webhookTransientOf(event: CallbackEvent): WebhookTransient | null {
  switch (event.type) {
    case EngineEventType.ENGINE_RESPONSE_RECEIVED:
      return engineResponseTransient(event);
    case EngineEventType.WORKFLOW_RUN_STARTED:
    case EngineEventType.WORKFLOW_RUN_COMPLETED:
    case EngineEventType.WORKFLOW_RUN_FAILED:
    case EngineEventType.WORKFLOW_RUN_CANCELLED:
      return runLifecycleTransient(event);
    case EngineEventType.MODULE_STORAGE_CHANGED:
      return storageChangedTransient(event);
    case EngineEventType.WIDGET_STATUS_CHANGED:
      return widgetStatusTransient(event);
    case EngineEventType.MODULE_INSTALLED:
      return moduleInstalledTransient({
        correlationKey: event.moduleKey,
        moduleName: event.moduleName,
        moduleVersion: event.version,
      });
    case EngineEventType.MODULE_INSTALL_FAILED:
      return moduleInstallFailedTransient(
        { correlationKey: event.moduleKey, moduleName: event.moduleName, moduleVersion: event.version },
        event.error || undefined
      );
    case EngineEventType.MODULE_DELETED:
      return moduleRemovedTransient({ correlationKey: event.moduleKey, moduleName: event.moduleName });
    case EngineEventType.MODULE_DELETE_FAILED:
      return moduleDeleteFailedTransient(
        { correlationKey: event.moduleKey, moduleName: event.moduleName },
        event.error || undefined,
        event.inUseResources
      );
    default:
      return null;
  }
}

const AT = "2026-10-21T12:00:00.000Z";
const run = { workflowId: "wf-1", executionId: "ex-1", triggeredBy: "dashboard", occurredAt: AT };
const module = { modulePrefix: "obs", moduleName: "obs", moduleKey: "obs:1.0.0" };

const FIXTURES: CallbackEvent[] = [
  { type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey: "c-1", status: "success", data: { n: 1 } },
  { type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey: "c-1", status: "error", error: "nope" },
  { type: EngineEventType.WORKFLOW_RUN_STARTED, triggerId: "t-1", ...run },
  { type: EngineEventType.WORKFLOW_RUN_COMPLETED, triggerId: "t-1", ...run },
  { type: EngineEventType.WORKFLOW_RUN_COMPLETED, ...run },
  { type: EngineEventType.WORKFLOW_RUN_FAILED, triggerId: "t-1", error: "boom", ...run },
  { type: EngineEventType.WORKFLOW_RUN_CANCELLED, triggerId: "t-1", reason: "cancelled: stop", ...run },
  {
    type: EngineEventType.MODULE_STORAGE_CHANGED,
    moduleId: "m-1",
    key: "count",
    value: 2,
    previousValue: 1,
    occurredAt: AT,
  } as CallbackEvent,
  {
    type: EngineEventType.WIDGET_STATUS_CHANGED,
    moduleId: "m-1",
    instanceId: "w-1",
    widgetCanonicalId: "m-1:widget:counter",
    key: "count",
    value: 3,
    occurredAt: AT,
  },
  {
    type: EngineEventType.WIDGET_STATUS_CHANGED,
    moduleId: "m-1",
    instanceId: "w-1",
    key: "k",
    value: 0,
    occurredAt: AT,
  },
  { type: EngineEventType.MODULE_INSTALLED, version: "1.0.0", ...module },
  { type: EngineEventType.MODULE_INSTALL_FAILED, version: "1.0.0", error: "bad archive", ...module },
  { type: EngineEventType.MODULE_INSTALL_FAILED, version: "1.0.0", error: "", ...module },
  { type: EngineEventType.MODULE_DELETED, ...module },
  { type: EngineEventType.MODULE_DELETE_FAILED, error: "in use", inUseResources: [], ...module },
  { type: EngineEventType.MODULE_DELETE_FAILED, error: "", inUseResources: [], ...module },
  { type: EngineEventType.GROUP_DELETED, groupId: "g-1" },
];

describe("transient events under both gateways", () => {
  for (const [index, event] of FIXTURES.entries()) {
    test(`${event.type} #${index}`, () => {
      const direct = transientOf(makeCallbackEnvelope(event, "engine", `env-${index}`, AT));
      expect(direct).toEqual(webhookTransientOf(event) as never);
    });
  }
});
