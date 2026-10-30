import { canonicalRefFromProjectionKey } from "@shared/canonical-ref";
import { actionDefinitionRow, triggerDefinitionRow } from "@shared/definition-rows";
import { bareModuleKey } from "@shared/module-key";
import { isWebhookTrigger } from "@shared/webhook-endpoint-key";
import type { ParsedWorkflowHealth } from "@shared/workflow-health";
import type {
  AlertSnapshot,
  Workflow as EngineWorkflow,
  WorkflowCatalog as EngineWorkflowCatalog,
  WorkflowRunDetail as EngineWorkflowRunDetail,
  WorkflowRunSnapshot,
  WorkflowRunStepSnapshot,
} from "@woofx3/api";
import type {
  NotRunningWorkflow,
  RecordedWorkflowRun,
  Workflow,
  WorkflowCatalog,
  WorkflowCatalogAction,
  WorkflowCatalogTrigger,
  WorkflowRun,
  WorkflowRunAlert,
  WorkflowRunDetail,
  WorkflowRunRecord,
  WorkflowRunStep,
} from "@/engine/types";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { toModuleId } from "../ids";
import { toEngineAlert } from "./alerts";

/** Epoch ms of an engine timestamp; throws for one that does not parse, since lists are ordered by it. */
function epochMs(iso: string, what: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new Error(`The engine sent a ${what} that is not a time: ${JSON.stringify(iso)}`);
  }
  return ms;
}

/**
 * A workflow as every gateway serves it, its definition's `$` keys escaped
 * (lib/dollar-keys). Null for a row with no definition yet: nothing can show
 * or run it, and the Convex mirror leaves such rows out too.
 */
export function toWorkflow(workflow: EngineWorkflow): Workflow | null {
  if (workflow.definition === null) {
    return null;
  }
  return {
    engineWorkflowId: workflow.id,
    definition: escapeDollarKeys(workflow.definition),
    isEnabled: workflow.isEnabled,
    createdAt: epochMs(workflow.createdAt, "workflow creation time"),
    updatedAt: epochMs(workflow.updatedAt, "workflow update time"),
  };
}

/** The module a definition belongs to, by its manifest id; none for the engine's own. */
function moduleKeyOf(definition: { createdByType: string; createdByRef: string }): string | undefined {
  return definition.createdByType === "MODULE" ? bareModuleKey(definition.createdByRef) : undefined;
}

/**
 * The builder's catalog, built from the same rows the Convex mirror stores.
 * A definition is grouped by its module's display name (`moduleLabels`, by
 * manifest id), or by its id when the engine no longer lists the module; the
 * engine's own definitions carry `builtinLabel`. Webhook triggers are fired
 * by their module's handler, so nothing in the builder binds to them.
 */
export function toWorkflowCatalog(
  catalog: EngineWorkflowCatalog,
  moduleLabels: ReadonlyMap<string, string>,
  builtinLabel: string
): WorkflowCatalog {
  const owner = (definition: { createdByType: string; createdByRef: string }) => {
    const key = moduleKeyOf(definition);
    return {
      key,
      moduleId: key === undefined ? undefined : toModuleId(key),
      moduleName: key,
      moduleLabel: key === undefined ? builtinLabel : (moduleLabels.get(key) ?? key),
    };
  };

  const triggers: WorkflowCatalogTrigger[] = [];
  for (const definition of catalog.triggers) {
    const { key, moduleId, moduleName, moduleLabel } = owner(definition);
    const row = triggerDefinitionRow(definition, key);
    if (isWebhookTrigger(row)) {
      continue;
    }
    triggers.push({
      id: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      color: row.color,
      icon: row.icon,
      event: row.event,
      allowVariants: row.allowVariants,
      configFields: row.configFields,
      emits: row.emits,
      sentence: row.sentence,
      summary: row.summary,
      summaryDetails: row.summaryDetails,
      projectionKey: row.projectionKey,
      taxonomy: row.taxonomy,
      transport: row.transport,
      canonicalRef: canonicalRefFromProjectionKey(row.projectionKey, "trigger"),
      moduleId,
      moduleName,
      moduleLabel,
    });
  }

  const actions: WorkflowCatalogAction[] = catalog.actions.map((definition) => {
    const { key, moduleId, moduleName, moduleLabel } = owner(definition);
    const row = actionDefinitionRow(definition, key);
    return {
      id: row.slug,
      name: row.name,
      description: row.description,
      category: row.category,
      color: row.color,
      icon: row.icon,
      configFields: row.configFields,
      returns: row.returns,
      sentence: row.sentence,
      projectionKey: row.projectionKey,
      taxonomy: row.taxonomy,
      canonicalRef: canonicalRefFromProjectionKey(row.projectionKey, "action"),
      handlerType: row.handlerType,
      functionCall: row.functionCall,
      moduleId,
      moduleName,
      moduleLabel,
    };
  });

  return { triggers, actions };
}

function toWorkflowRunRecord(run: WorkflowRunSnapshot & { workflowName: string }): WorkflowRunRecord {
  return {
    engineRunId: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName || undefined,
    status: run.status,
    triggeredBy: run.triggeredBy || undefined,
    triggerEvent: run.triggerEvent || undefined,
    dryRun: run.dryRun,
    error: run.error || undefined,
    startedAt: run.startedAt || undefined,
    completedAt: run.completedAt || undefined,
    engineCreatedAt: run.createdAt,
    engineUpdatedAt: run.updatedAt,
  };
}

function toWorkflowRunStep(step: WorkflowRunStepSnapshot): WorkflowRunStep {
  return {
    engineStepId: step.id,
    runId: step.executionId,
    taskId: step.taskId,
    stepIndex: step.stepIndex,
    attempt: step.attempt,
    name: step.name || undefined,
    status: step.status,
    inputs: step.inputs || undefined,
    outputs: step.outputs || undefined,
    error: step.error || undefined,
    durationMs: step.durationMs,
    startedAt: step.startedAt || undefined,
    completedAt: step.completedAt || undefined,
    engineCreatedAt: step.createdAt,
    engineUpdatedAt: step.updatedAt,
  };
}

function toWorkflowRunAlert(snapshot: AlertSnapshot, now: number): WorkflowRunAlert {
  const alert = toEngineAlert(snapshot, now);
  return {
    engineAlertId: alert.engineAlertId,
    status: alert.status,
    payload: alert.payload,
    error: alert.error,
    dispatchedAt: alert.dispatchedAt,
    playedAt: alert.playedAt,
    completedAt: alert.completedAt,
    engineCreatedAt: alert.engineCreatedAt,
    unconfirmedAt: alert.unconfirmedAt,
  };
}

/** A recorded run with its steps in the order the engine ran them, and the alerts it published; read at `now`. */
export function toWorkflowRunDetail(detail: EngineWorkflowRunDetail | null, now: number): WorkflowRunDetail {
  if (detail === null) {
    return null;
  }
  return {
    run: toWorkflowRunRecord(detail.run),
    steps: [...detail.steps].sort((a, b) => a.stepIndex - b.stepIndex || a.attempt - b.attempt).map(toWorkflowRunStep),
    alerts: detail.alerts.map((alert) => toWorkflowRunAlert(alert, now)),
  };
}

export function toRecordedWorkflowRun(run: WorkflowRunSnapshot): RecordedWorkflowRun {
  return {
    engineRunId: run.id,
    status: run.status,
    triggeredBy: run.triggeredBy || undefined,
    error: run.error || undefined,
    startedAt: run.startedAt || undefined,
    completedAt: run.completedAt || undefined,
    hasTriggerEvent: Boolean(run.triggerEvent),
    dryRun: run.dryRun === true,
  };
}

/**
 * Enabled workflows the engine reports it could not set up. A disabled
 * workflow is not meant to run, so its error is not news.
 */
export function toNotRunning(
  health: readonly ParsedWorkflowHealth[],
  enabledIds: ReadonlySet<string>
): NotRunningWorkflow[] {
  return health
    .filter((entry) => entry.status === "error" && enabledIds.has(entry.engineWorkflowId))
    .map((entry) => ({ engineWorkflowId: entry.engineWorkflowId, reason: entry.reason ?? null, since: entry.since }));
}

/** A run lifecycle event, as the engine sends it on the event stream. */
export type RunLifecycleEvent =
  | { kind: "started"; workflowId: string; executionId: string; triggeredBy?: string; occurredAt: string }
  | { kind: "completed"; workflowId: string; executionId: string; triggeredBy?: string; occurredAt: string }
  | { kind: "failed"; workflowId: string; executionId: string; triggeredBy?: string; occurredAt: string; error: string }
  | {
      kind: "cancelled";
      workflowId: string;
      executionId: string;
      triggeredBy?: string;
      occurredAt: string;
      reason: string;
    };

const RUN_STATUS: { readonly [K in RunLifecycleEvent["kind"]]: WorkflowRun["status"] } = {
  started: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

/**
 * The run an event reports, carrying on from `previous` (the same run's last
 * report, if any): a run's start is only in its `started` event, so a later
 * event keeps it, and one whose start was missed starts when it was first
 * heard of. `workflowName` names the workflow, or is its id when unknown.
 */
export function toWorkflowRun(
  event: RunLifecycleEvent,
  previous: WorkflowRun | undefined,
  workflowName: string
): WorkflowRun {
  const occurredAt = new Date(epochMs(event.occurredAt, "run event time"));
  const settled = event.kind !== "started";
  return {
    id: event.executionId,
    workflowId: event.workflowId,
    workflowName,
    status: RUN_STATUS[event.kind],
    startedAt: previous?.startedAt ?? occurredAt,
    completedAt: settled ? occurredAt : undefined,
    triggeredBy: event.triggeredBy ?? previous?.triggeredBy,
    error: event.kind === "failed" ? event.error : event.kind === "cancelled" ? event.reason : undefined,
  };
}
