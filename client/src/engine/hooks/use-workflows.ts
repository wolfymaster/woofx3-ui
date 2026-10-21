import { useEngineGateway } from "@/engine/context";

/** Every workflow on the instance. */
export function useWorkflows() {
  return useEngineGateway().workflows.useWorkflows();
}

/** Whether the instance has any workflow; null while membership cannot be confirmed. */
export function useHasWorkflows() {
  return useEngineGateway().workflows.useHasAny();
}

/** One workflow by the engine's id, or null until mirrored; a null engine id skips the read. */
export function useWorkflow(engineWorkflowId: string | null) {
  return useEngineGateway().workflows.useWorkflow(engineWorkflowId);
}

/** The workflow builder's trigger and action catalog, or null. */
export function useRawWorkflowCatalog() {
  return useEngineGateway().workflows.useCatalog();
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

/** A recorded run with its steps; a null run id skips the read. */
export function useWorkflowRun(engineRunId: string | null) {
  return useEngineGateway().workflows.useRun(engineRunId);
}

/** A workflow's recorded runs, newest first. */
export function useWorkflowRuns(engineWorkflowId: string, limit: number) {
  return useEngineGateway().workflows.useRuns(engineWorkflowId, limit);
}

/** Subscribes to runs as the engine pushes them; the returned function unsubscribes. */
export function useWorkflowRunsSubscription() {
  return useEngineGateway().workflows.useRunsSubscription();
}

/** Enabled workflows the engine could not set up. */
export function useNotRunningWorkflowList() {
  return useEngineGateway().workflows.useNotRunning();
}

export function useWorkflowHealthResyncRequest() {
  return useEngineGateway().workflows.useHealthResyncRequest();
}
