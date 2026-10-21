import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { WorkflowsGateway } from "@/engine/gateway";
import type {
  Live,
  RecordedWorkflowRun,
  Workflow,
  WorkflowCatalog,
  WorkflowCatalogAction,
  WorkflowCatalogTrigger,
  WorkflowHealthResyncTrigger,
  WorkflowReplay,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunRecord,
  WorkflowRunStep,
  WorkflowTrigger,
} from "@/engine/types";
import { transport } from "@/lib/transport";
import type { WorkflowRun as TransportWorkflowRun } from "@/lib/transport/interface";
import { toModuleId } from "./ids";
import { useMappedList, useMappedValue } from "./mapped";
import { requireInstance, useInstanceAction, useScopeInstanceId } from "./scope";

type CatalogRow = NonNullable<FunctionReturnType<typeof api.workflowCatalog.get>>;
type RunDetailRow = NonNullable<FunctionReturnType<typeof api.workflowRuns.runWithSteps>>;
type RecordedRunRow = FunctionReturnType<typeof api.workflowRuns.listForWorkflow>[number];

function toWorkflow(row: Doc<"workflows">): Workflow {
  return {
    engineWorkflowId: row.engineWorkflowId,
    definition: row.definition,
    isEnabled: row.isEnabled,
    nodes: row.nodes,
    edges: row.edges,
    projectionKey: row.projectionKey,
    projectionUpdatedAt: row.projectionUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toWorkflowCatalogTrigger(row: CatalogRow["triggers"][number]): WorkflowCatalogTrigger {
  return {
    id: row.id,
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
    canonicalRef: row.canonicalRef,
    moduleId: toModuleId(row.moduleId),
    moduleName: row.moduleName,
    moduleLabel: row.moduleLabel,
  };
}

function toWorkflowCatalogAction(row: CatalogRow["actions"][number]): WorkflowCatalogAction {
  return {
    id: row.id,
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
    canonicalRef: row.canonicalRef,
    handlerType: row.handlerType,
    functionCall: row.functionCall,
    moduleId: toModuleId(row.moduleId),
    moduleName: row.moduleName,
    moduleLabel: row.moduleLabel,
  };
}

function toWorkflowCatalog({ triggers, actions }: CatalogRow): WorkflowCatalog {
  return { triggers: triggers.map(toWorkflowCatalogTrigger), actions: actions.map(toWorkflowCatalogAction) };
}

function toWorkflowRunRecord(row: RunDetailRow["run"]): WorkflowRunRecord {
  return {
    engineRunId: row.engineRunId,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    status: row.status,
    triggeredBy: row.triggeredBy,
    triggerEvent: row.triggerEvent,
    dryRun: row.dryRun,
    error: row.error,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    engineCreatedAt: row.engineCreatedAt,
    engineUpdatedAt: row.engineUpdatedAt,
    createdAt: row.createdAt,
  };
}

function toWorkflowRunStep(row: Doc<"workflowRunSteps">): WorkflowRunStep {
  return {
    engineStepId: row.engineStepId,
    runId: row.runId,
    taskId: row.taskId,
    stepIndex: row.stepIndex,
    attempt: row.attempt,
    name: row.name,
    status: row.status,
    inputs: row.inputs,
    outputs: row.outputs,
    error: row.error,
    durationMs: row.durationMs,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    engineCreatedAt: row.engineCreatedAt,
    engineUpdatedAt: row.engineUpdatedAt,
    createdAt: row.createdAt,
  };
}

function toWorkflowRunDetail({ run, steps, alerts }: RunDetailRow): NonNullable<WorkflowRunDetail> {
  return { run: toWorkflowRunRecord(run), steps: steps.map(toWorkflowRunStep), alerts };
}

function toRecordedWorkflowRun(row: RecordedRunRow): RecordedWorkflowRun {
  return {
    engineRunId: row.engineRunId,
    status: row.status,
    triggeredBy: row.triggeredBy,
    error: row.error,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    hasTriggerEvent: row.hasTriggerEvent,
    dryRun: row.dryRun,
  };
}

function useWorkflows() {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.workflows.list, instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toWorkflow);
}

function useHasAny() {
  const instanceId = useScopeInstanceId();
  return useQuery(api.workflows.hasAny, instanceId ? { instanceId } : "skip");
}

function useWorkflow(engineWorkflowId: string | null) {
  const instanceId = useScopeInstanceId();
  const row = useQuery(
    api.workflows.getByEngineId,
    instanceId && engineWorkflowId !== null ? { instanceId, engineWorkflowId } : "skip"
  );
  return useMappedValue(row, toWorkflow);
}

function useCatalog() {
  const instanceId = useScopeInstanceId();
  const catalog = useQuery(api.workflowCatalog.get, instanceId ? { instanceId } : "skip");
  return useMappedValue(catalog, toWorkflowCatalog);
}

function useCreateRequest() {
  const createFromDefinition = useInstanceAction(api.workflowActions.createFromDefinition);
  return useCallback((definition: unknown) => createFromDefinition({ definition }), [createFromDefinition]);
}

function useUpdateRequest() {
  const updateFromDefinition = useInstanceAction(api.workflowActions.updateFromDefinition);
  return useCallback(
    (engineWorkflowId: string, definition: unknown) => updateFromDefinition({ engineWorkflowId, definition }),
    [updateFromDefinition]
  );
}

function useRemoveRequest() {
  const deleteByEngineId = useInstanceAction(api.workflowActions.deleteByEngineId);
  return useCallback((engineWorkflowId: string) => deleteByEngineId({ engineWorkflowId }), [deleteByEngineId]);
}

function useSetEnabledRequest() {
  const setEnabled = useInstanceAction(api.workflowActions.setEnabled);
  return useCallback(
    (engineWorkflowId: string, isEnabled: boolean) => setEnabled({ engineWorkflowId, isEnabled }),
    [setEnabled]
  );
}

function useTriggerRequest() {
  const trigger = useInstanceAction(api.workflowActions.trigger);
  return useCallback((run: WorkflowTrigger) => trigger(run), [trigger]);
}

function useTestRunCapabilitiesRequest() {
  const testRunCapabilities = useInstanceAction(api.workflowActions.testRunCapabilities);
  return useCallback(() => testRunCapabilities({}), [testRunCapabilities]);
}

function useViewerFactsRequest() {
  const listViewerFacts = useInstanceAction(api.viewerFacts.list);
  return useCallback(() => listViewerFacts({}), [listViewerFacts]);
}

function useReplayRequest() {
  const replay = useInstanceAction(api.workflowActions.replay);
  return useCallback((run: WorkflowReplay) => replay(run), [replay]);
}

function useCancelRunRequest() {
  const cancelRun = useInstanceAction(api.workflowActions.cancelRun);
  return useCallback((engineRunId: string) => cancelRun({ engineRunId }), [cancelRun]);
}

function useRun(engineRunId: string | null): Live<WorkflowRunDetail> {
  const instanceId = useScopeInstanceId();
  const detail = useQuery(
    api.workflowRuns.runWithSteps,
    instanceId && engineRunId !== null ? { instanceId, engineRunId } : "skip"
  );
  return useMappedValue(detail, toWorkflowRunDetail);
}

function useRuns(engineWorkflowId: string, limit: number) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(
    api.workflowRuns.listForWorkflow,
    instanceId ? { instanceId, workflowId: engineWorkflowId, limit } : "skip"
  );
  return useMappedList(rows, toRecordedWorkflowRun);
}

export function toWorkflowRun(run: TransportWorkflowRun): WorkflowRun {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    triggeredBy: run.triggeredBy,
    error: run.error,
    progress: run.progress,
  };
}

// The live transport holds one session, to the current instance's engine;
// this still refuses while the scope has no instance, like every other call.
function useRunsSubscription() {
  const instanceId = useScopeInstanceId();
  return useCallback(
    (onRun: (run: WorkflowRun) => void) =>
      transport.subscribeWorkflowRuns(requireInstance(instanceId), (run) => onRun(toWorkflowRun(run))),
    [instanceId]
  );
}

function useNotRunning() {
  const instanceId = useScopeInstanceId();
  return useQuery(api.workflowHealth.listNotRunning, instanceId ? { instanceId } : "skip");
}

function useHealthResyncRequest() {
  const resync = useInstanceAction(api.workflowHealth.resync);
  return useCallback((trigger: WorkflowHealthResyncTrigger) => resync({ trigger }), [resync]);
}

export const convexWorkflowsGateway: WorkflowsGateway = {
  useWorkflows,
  useHasAny,
  useWorkflow,
  useCatalog,
  useCreateRequest,
  useUpdateRequest,
  useRemoveRequest,
  useSetEnabledRequest,
  useTriggerRequest,
  useTestRunCapabilitiesRequest,
  useViewerFactsRequest,
  useReplayRequest,
  useCancelRunRequest,
  useRun,
  useRuns,
  useRunsSubscription,
  useNotRunning,
  useHealthResyncRequest,
};
