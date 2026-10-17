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
