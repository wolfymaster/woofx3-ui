import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { ModuleResourcesGateway } from "@/engine/gateway";
import type { InstanceId, ModuleId, ModuleResourceInstanceChanges, NewModuleResourceInstance } from "@/engine/types";

function useInstances(instanceId: InstanceId | null) {
  return useQuery(api.moduleResourceInstances.listForInstance, instanceId ? { instanceId } : "skip");
}

function useModuleInstances(instanceId: InstanceId | null, moduleId: ModuleId | null) {
  return useQuery(api.moduleResourceInstances.listByModule, instanceId && moduleId ? { instanceId, moduleId } : "skip");
}

function useKindInstances(instanceId: InstanceId | null, kind: string | null) {
  return useQuery(api.moduleResourceInstances.listByKind, instanceId && kind !== null ? { instanceId, kind } : "skip");
}

function useValues(instanceId: InstanceId | null) {
  return useQuery(api.resourceValues.listForInstance, instanceId ? { instanceId } : "skip");
}

function useKind(instanceId: InstanceId | null, kind: string | null) {
  return useQuery(api.resourceKinds.getForInstance, instanceId && kind !== null ? { instanceId, kind } : "skip");
}

function useKinds(instanceId: InstanceId | null) {
  return useQuery(api.resourceKinds.listForInstance, instanceId ? { instanceId } : "skip");
}

function useCreateRequest() {
  const createResourceInstance = useAction(api.moduleResourceActions.createResourceInstance);
  return useCallback(
    (instanceId: InstanceId, resource: NewModuleResourceInstance) =>
      createResourceInstance({ instanceId, ...resource }),
    [createResourceInstance]
  );
}

function useUpdateRequest() {
  const updateResourceInstance = useAction(api.moduleResourceActions.updateResourceInstance);
  return useCallback(
    (instanceId: InstanceId, changes: ModuleResourceInstanceChanges) =>
      updateResourceInstance({ instanceId, ...changes }),
    [updateResourceInstance]
  );
}

function useRemoveRequest() {
  const deleteResourceInstance = useAction(api.moduleResourceActions.deleteResourceInstance);
  return useCallback(
    (instanceId: InstanceId, canonicalId: string) => deleteResourceInstance({ instanceId, canonicalId }),
    [deleteResourceInstance]
  );
}

function useSyncModuleRequest() {
  const syncResourceInstancesForModule = useAction(api.moduleResourceActions.syncResourceInstancesForModule);
  return useCallback(
    (instanceId: InstanceId, moduleDbId: ModuleId) => syncResourceInstancesForModule({ instanceId, moduleDbId }),
    [syncResourceInstancesForModule]
  );
}

function useRefreshValuesRequest() {
  const refreshResourceValues = useAction(api.moduleResourceActions.refreshResourceValues);
  return useCallback(
    (instanceId: InstanceId, kind: string) => refreshResourceValues({ instanceId, kind }),
    [refreshResourceValues]
  );
}

function useRunActionsRequest() {
  const runActions = useAction(api.moduleResourceActions.runActions);
  return useCallback(
    (instanceId: InstanceId, label: string, actions: unknown[]) => runActions({ instanceId, label, actions }),
    [runActions]
  );
}

export const convexModuleResourcesGateway: ModuleResourcesGateway = {
  useInstances,
  useModuleInstances,
  useKindInstances,
  useValues,
  useKind,
  useKinds,
  useCreateRequest,
  useUpdateRequest,
  useRemoveRequest,
  useSyncModuleRequest,
  useRefreshValuesRequest,
  useRunActionsRequest,
};
