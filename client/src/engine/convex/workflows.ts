import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { WorkflowsGateway } from "@/engine/gateway";
import type { InstanceId } from "@/engine/types";

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

export const convexWorkflowsGateway: WorkflowsGateway = {
  useWorkflows,
  useHasAny,
  useWorkflow,
  useCatalog,
};
