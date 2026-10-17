import { useEngineGateway } from "@/engine/context";
import type { InstanceId, ModuleId } from "@/engine/types";

/** Every module resource instance on the instance; a null id skips the read. */
export function useResourceInstances(instanceId: InstanceId | null) {
  return useEngineGateway().moduleResources.useInstances(instanceId);
}

/** One installed module's resource instances; skipped unless both ids are set. */
export function useModuleResourceInstances(instanceId: InstanceId | null, moduleId: ModuleId | null) {
  return useEngineGateway().moduleResources.useModuleInstances(instanceId, moduleId);
}

/** The resource instances of one kind (`module:kind` or bare); a null id or kind skips the read. */
export function useResourceInstancesOfKind(instanceId: InstanceId | null, kind: string | null) {
  return useEngineGateway().moduleResources.useKindInstances(instanceId, kind);
}

/** Every mirrored resource value, keyed by canonical id; a null id skips the read. */
export function useResourceValues(instanceId: InstanceId | null) {
  return useEngineGateway().moduleResources.useValues(instanceId);
}

/** The module providing a resource kind and its declaration, or null; a null id or kind skips the read. */
export function useResourceKind(instanceId: InstanceId | null, kind: string | null) {
  return useEngineGateway().moduleResources.useKind(instanceId, kind);
}

/** Every resource kind the installed modules declare; a null id skips the read. */
export function useResourceKinds(instanceId: InstanceId | null) {
  return useEngineGateway().moduleResources.useKinds(instanceId);
}

export function useCreateResourceInstanceRequest() {
  return useEngineGateway().moduleResources.useCreateRequest();
}

export function useUpdateResourceInstanceRequest() {
  return useEngineGateway().moduleResources.useUpdateRequest();
}

export function useDeleteResourceInstanceRequest() {
  return useEngineGateway().moduleResources.useRemoveRequest();
}

export function useSyncModuleResourceInstancesRequest() {
  return useEngineGateway().moduleResources.useSyncModuleRequest();
}

export function useRefreshResourceValuesRequest() {
  return useEngineGateway().moduleResources.useRefreshValuesRequest();
}

export function useRunResourceActionsRequest() {
  return useEngineGateway().moduleResources.useRunActionsRequest();
}
