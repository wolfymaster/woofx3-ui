import {
  EngineEventType,
  type EngineResponseReceivedEvent,
  type ModuleStorageChangedEvent,
  type WidgetStatusChangedEvent,
  type WorkflowRunCancelledEvent,
  type WorkflowRunCompletedEvent,
  type WorkflowRunFailedEvent,
  type WorkflowRunStartedEvent,
} from "@woofx3/api/webhooks";

// The transient events engine callbacks leave for a caller following work by
// correlation key, as pure values. The webhook writes them to transientEvents;
// the direct gateway projects the same ones from the engine event stream
// (client/src/engine/direct/TransientEventStore.ts), and
// client/src/engine/direct/webhook-parity.test.ts holds the two together.

export interface WebhookTransient {
  correlationKey: string;
  type: string;
  status: "progress" | "success" | "error";
  message?: string;
  data?: unknown;
}

export const MODULE_INSTALL_FAILED_FALLBACK = "Module installation failed on the engine.";
export const MODULE_DELETE_REFUSED_FALLBACK = "Module delete was refused by the engine.";

export function engineResponseTransient(event: EngineResponseReceivedEvent): WebhookTransient {
  return {
    correlationKey: event.correlationKey,
    type: "engine.response",
    status: event.status,
    message: event.error,
    data: event.data,
  };
}

type RunLifecycleEvent =
  | WorkflowRunStartedEvent
  | WorkflowRunCompletedEvent
  | WorkflowRunFailedEvent
  | WorkflowRunCancelledEvent;

const RUN_OUTCOMES: Record<RunLifecycleEvent["type"], WebhookTransient["status"]> = {
  [EngineEventType.WORKFLOW_RUN_STARTED]: "progress",
  [EngineEventType.WORKFLOW_RUN_COMPLETED]: "success",
  [EngineEventType.WORKFLOW_RUN_FAILED]: "error",
  [EngineEventType.WORKFLOW_RUN_CANCELLED]: "error",
};

/**
 * A run somebody is waiting on, keyed by the client-generated `triggerId` its
 * request carried, so the caller subscribes before the run exists. Null for a
 * run nobody asked for: there is no key to write it under.
 */
export function runLifecycleTransient(event: RunLifecycleEvent): WebhookTransient | null {
  if (!event.triggerId) {
    return null;
  }
  const message =
    event.type === EngineEventType.WORKFLOW_RUN_FAILED
      ? event.error
      : event.type === EngineEventType.WORKFLOW_RUN_CANCELLED
        ? event.reason
        : undefined;
  return {
    correlationKey: event.triggerId,
    type: event.type,
    status: RUN_OUTCOMES[event.type],
    message,
    data: {
      workflowId: event.workflowId,
      executionId: event.executionId,
      triggeredBy: event.triggeredBy,
      occurredAt: event.occurredAt,
    },
  };
}

export function storageChangedTransient(event: ModuleStorageChangedEvent): WebhookTransient {
  return {
    correlationKey: `${event.moduleId}:${event.key}`,
    type: "module.storage.changed",
    status: "success",
    data: {
      moduleId: event.moduleId,
      key: event.key,
      value: event.value,
      previousValue: event.previousValue,
      occurredAt: event.occurredAt,
    },
  };
}

export function widgetStatusTransient(event: WidgetStatusChangedEvent): WebhookTransient {
  return {
    correlationKey: event.widgetCanonicalId ?? `${event.moduleId}:${event.instanceId}:${event.key}`,
    type: "widget.status.changed",
    status: "success",
    data: {
      moduleId: event.moduleId,
      widgetInstanceId: event.instanceId,
      widgetCanonicalId: event.widgetCanonicalId,
      key: event.key,
      value: event.value,
      occurredAt: event.occurredAt,
    },
  };
}

interface ModuleRef {
  /** The module key the install or uninstall was requested under. */
  correlationKey: string;
  moduleName: string;
  moduleVersion?: string;
}

export function moduleInstalledTransient(module: ModuleRef & { moduleVersion: string }): WebhookTransient {
  return {
    correlationKey: module.correlationKey,
    type: "module.install",
    status: "success",
    message: `Module ${module.moduleName}@${module.moduleVersion} installed successfully.`,
  };
}

export function moduleInstallFailedTransient(
  module: ModuleRef & { moduleVersion: string },
  statusMessage: string | undefined
): WebhookTransient {
  return {
    correlationKey: module.correlationKey,
    type: "module.install",
    status: "error",
    message: statusMessage ?? MODULE_INSTALL_FAILED_FALLBACK,
    data: { moduleName: module.moduleName, moduleVersion: module.moduleVersion },
  };
}

export function moduleRemovedTransient(module: ModuleRef): WebhookTransient {
  const version = module.moduleVersion ? `@${module.moduleVersion}` : "";
  return {
    correlationKey: module.correlationKey,
    type: "module.uninstall",
    status: "success",
    message: `Module ${module.moduleName}${version} removed.`,
    data: { moduleName: module.moduleName, moduleVersion: module.moduleVersion },
  };
}

export function moduleDeleteFailedTransient(
  module: ModuleRef,
  error: string | undefined,
  conflicts: unknown[] | undefined
): WebhookTransient {
  return {
    correlationKey: module.correlationKey,
    type: "module.uninstall",
    status: "error",
    message: error ?? MODULE_DELETE_REFUSED_FALLBACK,
    data: { moduleName: module.moduleName, moduleVersion: module.moduleVersion, conflicts: conflicts ?? [] },
  };
}
