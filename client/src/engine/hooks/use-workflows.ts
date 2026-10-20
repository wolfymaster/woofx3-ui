import { useEngineGateway } from "@/engine/context";
import type { InstanceId } from "@/engine/types";

/** Every workflow on the instance; a null id skips the read. */
export function useWorkflows(instanceId: InstanceId | null) {
  return useEngineGateway().workflows.useWorkflows(instanceId);
}

/** Whether the instance has any workflow; null while membership cannot be confirmed. */
export function useHasWorkflows(instanceId: InstanceId) {
  return useEngineGateway().workflows.useHasAny(instanceId);
}

/** One workflow by the engine's id, or null until mirrored; a null id or engine id skips the read. */
export function useWorkflow(instanceId: InstanceId | null, engineWorkflowId: string | null) {
  return useEngineGateway().workflows.useWorkflow(instanceId, engineWorkflowId);
}

/** The workflow builder's trigger and action catalog, or null; a null id skips the read. */
export function useRawWorkflowCatalog(instanceId: InstanceId | null) {
  return useEngineGateway().workflows.useCatalog(instanceId);
}

/** Creates a workflow from a `$`-escaped definition; resolves with its engine id once mirrored. */
export function useCreateWorkflowRequest() {
  return useEngineGateway().workflows.useCreateRequest();
}

/** Replaces a workflow's `$`-escaped definition; resolves once mirrored. */
export function useUpdateWorkflowRequest() {
  return useEngineGateway().workflows.useUpdateRequest();
}

export function useDeleteWorkflowRequest() {
  return useEngineGateway().workflows.useRemoveRequest();
}

export function useSetWorkflowEnabledRequest() {
  return useEngineGateway().workflows.useSetEnabledRequest();
}

/** Starts a manual run; its progress arrives in transient events under the returned `triggerId`. */
export function useTriggerWorkflowRequest() {
  return useEngineGateway().workflows.useTriggerRequest();
}

export function useTestRunCapabilitiesRequest() {
  return useEngineGateway().workflows.useTestRunCapabilitiesRequest();
}

/** The values `${viewer.*}` resolves on the engine; ask only engines with `workflow.viewerFacts`. */
export function useViewerFactsRequest() {
  return useEngineGateway().workflows.useViewerFactsRequest();
}

/** Runs a recorded run again; its progress arrives in transient events under the returned `triggerId`. */
export function useReplayWorkflowRunRequest() {
  return useEngineGateway().workflows.useReplayRequest();
}

export function useCancelWorkflowRunRequest() {
  return useEngineGateway().workflows.useCancelRunRequest();
}

/** A recorded run with its steps; a null id or run id skips the read. */
export function useWorkflowRun(instanceId: InstanceId | null, engineRunId: string | null) {
  return useEngineGateway().workflows.useRun(instanceId, engineRunId);
}

/** A workflow's recorded runs, newest first. */
export function useWorkflowRuns(instanceId: InstanceId, engineWorkflowId: string, limit: number) {
  return useEngineGateway().workflows.useRuns(instanceId, engineWorkflowId, limit);
}

/** Subscribes to runs as the engine pushes them; the returned function unsubscribes. */
export function useWorkflowRunsSubscription() {
  return useEngineGateway().workflows.useRunsSubscription();
}

/** Enabled workflows the engine could not set up; a null id skips the read. */
export function useNotRunningWorkflowList(instanceId: InstanceId | null) {
  return useEngineGateway().workflows.useNotRunning(instanceId);
}

export function useWorkflowHealthResyncRequest() {
  return useEngineGateway().workflows.useHealthResyncRequest();
}
