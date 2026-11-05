import { ENGINE_CAPABILITIES } from "@woofx3/api";
import { useEngineGateway } from "@/engine/context";
import { useEngineCapability } from "./use-engine-capabilities";

/** Every alert group on the instance. */
export function useWorkflowGroups() {
  return useEngineGateway().workflows.useGroups();
}

/**
 * Whether the engine has alert groups. False until the engine has reported,
 * so a screen shows nothing of groups rather than offering what an older
 * engine would refuse.
 */
export function useWorkflowGroupsSupported(): boolean {
  return useEngineCapability(ENGINE_CAPABILITIES.workflowsGroups);
}

export function useCreateWorkflowGroupRequest() {
  return useEngineGateway().workflows.useCreateGroupRequest();
}

/** Writes the name and description. */
export function useUpdateWorkflowGroupRequest() {
  return useEngineGateway().workflows.useUpdateGroupRequest();
}

export function useDeleteWorkflowGroupRequest() {
  return useEngineGateway().workflows.useRemoveGroupRequest();
}

export function useSetWorkflowGroupEnabledRequest() {
  return useEngineGateway().workflows.useSetGroupEnabledRequest();
}

export function useAddWorkflowGroupMembersRequest() {
  return useEngineGateway().workflows.useAddGroupMembersRequest();
}

export function useRemoveWorkflowGroupMembersRequest() {
  return useEngineGateway().workflows.useRemoveGroupMembersRequest();
}
