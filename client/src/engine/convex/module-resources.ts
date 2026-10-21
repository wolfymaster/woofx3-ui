import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { ModuleResourcesGateway } from "@/engine/gateway";
import type {
  InstanceId,
  ModuleId,
  ModuleResourceInstance,
  ModuleResourceInstanceChanges,
  NewModuleResourceInstance,
} from "@/engine/types";
import { fromInstanceId, fromModuleId, toModuleId } from "./ids";
import { useMappedList } from "./mapped";

function toModuleResourceInstance({
  _id,
  _creationTime,
  instanceId,
  moduleId,
  ...resource
}: Doc<"moduleResourceInstances">): ModuleResourceInstance {
  return { moduleId: toModuleId(moduleId), ...resource };
}

function useInstances(instanceId: InstanceId | null) {
  const rows = useQuery(
    api.moduleResourceInstances.listForInstance,
    instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip"
  );
  return useMappedList(rows, toModuleResourceInstance);
}

function useModuleInstances(instanceId: InstanceId | null, moduleId: ModuleId | null) {
  const rows = useQuery(
    api.moduleResourceInstances.listByModule,
    instanceId && moduleId ? { instanceId: fromInstanceId(instanceId), moduleId: fromModuleId(moduleId) } : "skip"
  );
  return useMappedList(rows, toModuleResourceInstance);
}

function useKindInstances(instanceId: InstanceId | null, kind: string | null) {
  const rows = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId && kind !== null ? { instanceId: fromInstanceId(instanceId), kind } : "skip"
  );
  return useMappedList(rows, toModuleResourceInstance);
}

function useKindsInstances(instanceId: InstanceId | null, kinds: readonly string[]) {
  const rows = useQuery(
    api.moduleResourceInstances.listByKinds,
    instanceId && kinds.length > 0 ? { instanceId: fromInstanceId(instanceId), kinds: [...kinds] } : "skip"
  );
  return useMappedList(rows, toModuleResourceInstance);
}

function useValues(instanceId: InstanceId | null) {
  return useQuery(api.resourceValues.listForInstance, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
}

function useKind(instanceId: InstanceId | null, kind: string | null) {
  return useQuery(
    api.resourceKinds.getForInstance,
    instanceId && kind !== null ? { instanceId: fromInstanceId(instanceId), kind } : "skip"
  );
}

function useKinds(instanceId: InstanceId | null) {
  return useQuery(api.resourceKinds.listForInstance, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
}

function useCreateRequest() {
  const createResourceInstance = useAction(api.moduleResourceActions.createResourceInstance);
  return useCallback(
    (instanceId: InstanceId, resource: NewModuleResourceInstance) =>
      createResourceInstance({ instanceId: fromInstanceId(instanceId), ...resource }),
    [createResourceInstance]
  );
}

function useUpdateRequest() {
  const updateResourceInstance = useAction(api.moduleResourceActions.updateResourceInstance);
  return useCallback(
    (instanceId: InstanceId, changes: ModuleResourceInstanceChanges) =>
      updateResourceInstance({ instanceId: fromInstanceId(instanceId), ...changes }),
    [updateResourceInstance]
  );
}

function useRemoveRequest() {
  const deleteResourceInstance = useAction(api.moduleResourceActions.deleteResourceInstance);
  return useCallback(
    (instanceId: InstanceId, canonicalId: string) =>
      deleteResourceInstance({ instanceId: fromInstanceId(instanceId), canonicalId }),
    [deleteResourceInstance]
  );
}

function useSyncModuleRequest() {
  const syncResourceInstancesForModule = useAction(api.moduleResourceActions.syncResourceInstancesForModule);
  return useCallback(
    (instanceId: InstanceId, moduleDbId: ModuleId) =>
      syncResourceInstancesForModule({ instanceId: fromInstanceId(instanceId), moduleDbId: fromModuleId(moduleDbId) }),
    [syncResourceInstancesForModule]
  );
}

function useRefreshValuesRequest() {
  const refreshResourceValues = useAction(api.moduleResourceActions.refreshResourceValues);
  return useCallback(
    (instanceId: InstanceId, kind: string) => refreshResourceValues({ instanceId: fromInstanceId(instanceId), kind }),
    [refreshResourceValues]
  );
}

function useRunActionsRequest() {
  const runActions = useAction(api.moduleResourceActions.runActions);
  return useCallback(
    (instanceId: InstanceId, label: string, actions: unknown[]) =>
      runActions({ instanceId: fromInstanceId(instanceId), label, actions }),
    [runActions]
  );
}

export const convexModuleResourcesGateway: ModuleResourcesGateway = {
  useInstances,
  useModuleInstances,
  useKindInstances,
  useKindsInstances,
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
