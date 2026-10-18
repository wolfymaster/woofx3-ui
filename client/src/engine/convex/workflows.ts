import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { WorkflowsGateway } from "@/engine/gateway";
import type { InstanceId, WorkflowReplay, WorkflowTrigger } from "@/engine/types";

function useWorkflows(instanceId: InstanceId | null) {
  return useQuery(api.workflows.list, instanceId ? { instanceId } : "skip");
}

function useHasAny(instanceId: InstanceId) {
  return useQuery(api.workflows.hasAny, { instanceId });
}

function useWorkflow(instanceId: InstanceId | null, engineWorkflowId: string | null) {
  return useQuery(
    api.workflows.getByEngineId,
    instanceId && engineWorkflowId !== null ? { instanceId, engineWorkflowId } : "skip"
  );
}

function useCatalog(instanceId: InstanceId | null) {
  return useQuery(api.workflowCatalog.get, instanceId ? { instanceId } : "skip");
}

function useCreateRequest() {
  const createFromDefinition = useAction(api.workflowActions.createFromDefinition);
  return useCallback(
    (instanceId: InstanceId, definition: unknown) => createFromDefinition({ instanceId, definition }),
    [createFromDefinition]
  );
}

function useUpdateRequest() {
  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);
  return useCallback(
    (instanceId: InstanceId, engineWorkflowId: string, definition: unknown) =>
      updateFromDefinition({ instanceId, engineWorkflowId, definition }),
    [updateFromDefinition]
  );
}

function useRemoveRequest() {
  const deleteByEngineId = useAction(api.workflowActions.deleteByEngineId);
  return useCallback(
    (instanceId: InstanceId, engineWorkflowId: string) => deleteByEngineId({ instanceId, engineWorkflowId }),
    [deleteByEngineId]
  );
}

function useSetEnabledRequest() {
  const setEnabled = useAction(api.workflowActions.setEnabled);
  return useCallback(
    (instanceId: InstanceId, engineWorkflowId: string, isEnabled: boolean) =>
      setEnabled({ instanceId, engineWorkflowId, isEnabled }),
    [setEnabled]
  );
}

function useTriggerRequest() {
  const trigger = useAction(api.workflowActions.trigger);
  return useCallback((instanceId: InstanceId, run: WorkflowTrigger) => trigger({ instanceId, ...run }), [trigger]);
}

function useTestRunCapabilitiesRequest() {
  const testRunCapabilities = useAction(api.workflowActions.testRunCapabilities);
  return useCallback((instanceId: InstanceId) => testRunCapabilities({ instanceId }), [testRunCapabilities]);
}

function useReplayRequest() {
  const replay = useAction(api.workflowActions.replay);
  return useCallback((instanceId: InstanceId, run: WorkflowReplay) => replay({ instanceId, ...run }), [replay]);
}

function useCancelRunRequest() {
  const cancelRun = useAction(api.workflowActions.cancelRun);
  return useCallback(
    (instanceId: InstanceId, engineRunId: string) => cancelRun({ instanceId, engineRunId }),
    [cancelRun]
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
  useReplayRequest,
  useCancelRunRequest,
};
