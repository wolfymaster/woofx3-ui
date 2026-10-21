import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { WorkflowsGateway } from "@/engine/gateway";
import type {
  InstanceId,
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
import { fromInstanceId, toModuleId } from "./ids";
import { useMappedList, useMappedValue } from "./mapped";

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

function useWorkflows(instanceId: InstanceId | null) {
  const rows = useQuery(api.workflows.list, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
  return useMappedList(rows, toWorkflow);
}

function useHasAny(instanceId: InstanceId) {
  return useQuery(api.workflows.hasAny, { instanceId: fromInstanceId(instanceId) });
}

function useWorkflow(instanceId: InstanceId | null, engineWorkflowId: string | null) {
  const row = useQuery(
    api.workflows.getByEngineId,
    instanceId && engineWorkflowId !== null ? { instanceId: fromInstanceId(instanceId), engineWorkflowId } : "skip"
  );
  return useMappedValue(row, toWorkflow);
}

function useCatalog(instanceId: InstanceId | null) {
  const catalog = useQuery(api.workflowCatalog.get, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
  return useMappedValue(catalog, toWorkflowCatalog);
}

function useCreateRequest() {
  const createFromDefinition = useAction(api.workflowActions.createFromDefinition);
  return useCallback(
    (instanceId: InstanceId, definition: unknown) =>
      createFromDefinition({ instanceId: fromInstanceId(instanceId), definition }),
    [createFromDefinition]
  );
}

function useUpdateRequest() {
  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);
  return useCallback(
    (instanceId: InstanceId, engineWorkflowId: string, definition: unknown) =>
      updateFromDefinition({ instanceId: fromInstanceId(instanceId), engineWorkflowId, definition }),
    [updateFromDefinition]
  );
}

function useRemoveRequest() {
  const deleteByEngineId = useAction(api.workflowActions.deleteByEngineId);
  return useCallback(
    (instanceId: InstanceId, engineWorkflowId: string) =>
      deleteByEngineId({ instanceId: fromInstanceId(instanceId), engineWorkflowId }),
    [deleteByEngineId]
  );
}

function useSetEnabledRequest() {
  const setEnabled = useAction(api.workflowActions.setEnabled);
  return useCallback(
    (instanceId: InstanceId, engineWorkflowId: string, isEnabled: boolean) =>
      setEnabled({ instanceId: fromInstanceId(instanceId), engineWorkflowId, isEnabled }),
    [setEnabled]
  );
}

function useTriggerRequest() {
  const trigger = useAction(api.workflowActions.trigger);
  return useCallback(
    (instanceId: InstanceId, run: WorkflowTrigger) => trigger({ instanceId: fromInstanceId(instanceId), ...run }),
    [trigger]
  );
}

function useTestRunCapabilitiesRequest() {
  const testRunCapabilities = useAction(api.workflowActions.testRunCapabilities);
  return useCallback(
    (instanceId: InstanceId) => testRunCapabilities({ instanceId: fromInstanceId(instanceId) }),
    [testRunCapabilities]
  );
}

function useViewerFactsRequest() {
  const listViewerFacts = useAction(api.viewerFacts.list);
  return useCallback(
    (instanceId: InstanceId) => listViewerFacts({ instanceId: fromInstanceId(instanceId) }),
    [listViewerFacts]
  );
}

function useReplayRequest() {
  const replay = useAction(api.workflowActions.replay);
  return useCallback(
    (instanceId: InstanceId, run: WorkflowReplay) => replay({ instanceId: fromInstanceId(instanceId), ...run }),
    [replay]
  );
}

function useCancelRunRequest() {
  const cancelRun = useAction(api.workflowActions.cancelRun);
  return useCallback(
    (instanceId: InstanceId, engineRunId: string) => cancelRun({ instanceId: fromInstanceId(instanceId), engineRunId }),
    [cancelRun]
  );
}

function useRun(instanceId: InstanceId | null, engineRunId: string | null): Live<WorkflowRunDetail> {
  const detail = useQuery(
    api.workflowRuns.runWithSteps,
    instanceId && engineRunId !== null ? { instanceId: fromInstanceId(instanceId), engineRunId } : "skip"
  );
  return useMappedValue(detail, toWorkflowRunDetail);
}

function useRuns(instanceId: InstanceId, engineWorkflowId: string, limit: number) {
  const rows = useQuery(api.workflowRuns.listForWorkflow, {
    instanceId: fromInstanceId(instanceId),
    workflowId: engineWorkflowId,
    limit,
  });
  return useMappedList(rows, toRecordedWorkflowRun);
}

// The transport is a module singleton, so this keeps its identity without memoising.
const subscribeRuns = (instanceId: InstanceId, onRun: (run: WorkflowRun) => void) =>
  transport.subscribeWorkflowRuns(instanceId, onRun);

function useNotRunning(instanceId: InstanceId | null) {
  return useQuery(api.workflowHealth.listNotRunning, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
}

function useHealthResyncRequest() {
  const resync = useAction(api.workflowHealth.resync);
  return useCallback(
    (instanceId: InstanceId, trigger: WorkflowHealthResyncTrigger) =>
      resync({ instanceId: fromInstanceId(instanceId), trigger }),
    [resync]
  );
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
  useRunsSubscription: () => subscribeRuns,
  useNotRunning,
  useHealthResyncRequest,
};
