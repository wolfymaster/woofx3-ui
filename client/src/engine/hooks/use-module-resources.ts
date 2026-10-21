import { useEngineGateway } from "@/engine/context";
import type { ModuleId } from "@/engine/types";

/** Every module resource instance on the instance. */
export function useResourceInstances() {
  return useEngineGateway().moduleResources.useInstances();
}

/** One installed module's resource instances; a null module id skips the read. */
export function useModuleResourceInstances(moduleId: ModuleId | null) {
  return useEngineGateway().moduleResources.useModuleInstances(moduleId);
}

/** The resource instances of one kind (`module:kind` or bare); a null kind skips the read. */
export function useResourceInstancesOfKind(kind: string | null) {
  return useEngineGateway().moduleResources.useKindInstances(kind);
}

/** The instances of several kinds in one read; skipped for no kinds. */
export function useResourceInstancesOfKinds(kinds: readonly string[]) {
  return useEngineGateway().moduleResources.useKindsInstances(kinds);
}

/** Every mirrored resource value, keyed by canonical id. */
export function useResourceValues() {
  return useEngineGateway().moduleResources.useValues();
}

/** The module providing a resource kind and its declaration, or null; a null kind skips the read. */
export function useResourceKind(kind: string | null) {
  return useEngineGateway().moduleResources.useKind(kind);
}

/** Every resource kind the installed modules declare. */
export function useResourceKinds() {
  return useEngineGateway().moduleResources.useKinds();
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
