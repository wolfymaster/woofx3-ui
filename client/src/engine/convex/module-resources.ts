import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback } from "react";
import type { ModuleResourcesGateway } from "@/engine/gateway";
import type {
  ModuleId,
  ModuleResourceInstance,
  ModuleResourceInstanceChanges,
  NewModuleResourceInstance,
} from "@/engine/types";
import { fromModuleId, toModuleId } from "./ids";
import { useMappedList } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

function toModuleResourceInstance(row: Doc<"moduleResourceInstances">): ModuleResourceInstance {
  return {
    canonicalId: row.canonicalId,
    engineInstanceId: row.engineInstanceId,
    resourceInstanceId: row.resourceInstanceId,
    kind: row.kind,
    moduleId: toModuleId(row.moduleId),
    moduleName: row.moduleName,
    displayName: row.displayName,
    settings: row.settings,
  };
}

function useInstances() {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.moduleResourceInstances.listForInstance, instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toModuleResourceInstance);
}

function useModuleInstances(moduleId: ModuleId | null) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(
    api.moduleResourceInstances.listByModule,
    instanceId && moduleId ? { instanceId, moduleId: fromModuleId(moduleId) } : "skip"
  );
  return useMappedList(rows, toModuleResourceInstance);
}

function useKindInstances(kind: string | null) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(
    api.moduleResourceInstances.listByKind,
    instanceId && kind !== null ? { instanceId, kind } : "skip"
  );
  return useMappedList(rows, toModuleResourceInstance);
}

function useKindsInstances(kinds: readonly string[]) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(
    api.moduleResourceInstances.listByKinds,
    instanceId && kinds.length > 0 ? { instanceId, kinds: [...kinds] } : "skip"
  );
  return useMappedList(rows, toModuleResourceInstance);
}

function useValues() {
  const instanceId = useScopeInstanceId();
  return useQuery(api.resourceValues.listForInstance, instanceId ? { instanceId } : "skip");
}

function useKind(kind: string | null) {
  const instanceId = useScopeInstanceId();
  return useQuery(api.resourceKinds.getForInstance, instanceId && kind !== null ? { instanceId, kind } : "skip");
}

function useKinds() {
  const instanceId = useScopeInstanceId();
  return useQuery(api.resourceKinds.listForInstance, instanceId ? { instanceId } : "skip");
}

function useCreateRequest() {
  const createResourceInstance = useInstanceAction(api.moduleResourceActions.createResourceInstance);
  return useCallback(
    (resource: NewModuleResourceInstance) => createResourceInstance(resource),
    [createResourceInstance]
  );
}

function useUpdateRequest() {
  const updateResourceInstance = useInstanceAction(api.moduleResourceActions.updateResourceInstance);
  return useCallback(
    (changes: ModuleResourceInstanceChanges) => updateResourceInstance(changes),
    [updateResourceInstance]
  );
}

function useRemoveRequest() {
  const deleteResourceInstance = useInstanceAction(api.moduleResourceActions.deleteResourceInstance);
  return useCallback((canonicalId: string) => deleteResourceInstance({ canonicalId }), [deleteResourceInstance]);
}

function useSyncModuleRequest() {
  const syncResourceInstancesForModule = useInstanceAction(api.moduleResourceActions.syncResourceInstancesForModule);
  return useCallback(
    (moduleDbId: ModuleId) => syncResourceInstancesForModule({ moduleDbId: fromModuleId(moduleDbId) }),
    [syncResourceInstancesForModule]
  );
}

function useRefreshValuesRequest() {
  const refreshResourceValues = useInstanceAction(api.moduleResourceActions.refreshResourceValues);
  return useCallback((kind: string) => refreshResourceValues({ kind }), [refreshResourceValues]);
}

function useRunActionsRequest() {
  const runActions = useInstanceAction(api.moduleResourceActions.runActions);
  return useCallback((label: string, actions: unknown[]) => runActions({ label, actions }), [runActions]);
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
