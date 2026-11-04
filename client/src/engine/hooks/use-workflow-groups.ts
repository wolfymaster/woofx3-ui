import { useEngineGateway } from "@/engine/context";
import { useFetched } from "./use-fetched";

/** Every alert group on the instance. */
export function useWorkflowGroups() {
  return useEngineGateway().workflows.useGroups();
}

/**
 * Whether the engine has alert groups. False until it answers, and when it
 * cannot be asked, so a screen shows nothing of groups rather than offering
 * what an older engine would refuse.
 */
export function useWorkflowGroupsSupported(): boolean {
  const supported = useEngineGateway().workflows.useGroupsSupportedRequest();
  return useFetched(supported, {}).data === true;
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
