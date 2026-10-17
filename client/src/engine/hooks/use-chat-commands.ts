import { useEngineGateway } from "@/engine/context";
import type { InstanceId } from "@/engine/types";

/** The instance's chat commands; a null id skips the read. */
export function useChatCommands(instanceId: InstanceId | null) {
  return useEngineGateway().commands.useCommands(instanceId);
}

/** The instance's chat command groups; a null id skips the read. */
export function useChatCommandGroups(instanceId: InstanceId | null) {
  return useEngineGateway().commands.useGroups(instanceId);
}

/** The usernames in one chat command group. */
export function useChatCommandGroupMembers(instanceId: InstanceId, engineGroupId: string) {
  return useEngineGateway().commands.useGroupMembers(instanceId, engineGroupId);
}

export function useCreateChatCommandRequest() {
  return useEngineGateway().commands.useCreateCommandRequest();
}

/** Replaces a command's whole definition. */
export function useUpdateChatCommandRequest() {
  return useEngineGateway().commands.useUpdateCommandRequest();
}

export function useDeleteChatCommandRequest() {
  return useEngineGateway().commands.useDeleteCommandRequest();
}

export function useCreateChatCommandGroupRequest() {
  return useEngineGateway().commands.useCreateGroupRequest();
}

export function useUpdateChatCommandGroupRequest() {
  return useEngineGateway().commands.useUpdateGroupRequest();
}

export function useDeleteChatCommandGroupRequest() {
  return useEngineGateway().commands.useDeleteGroupRequest();
}

export function useAddChatCommandGroupMemberRequest() {
  return useEngineGateway().commands.useAddGroupMemberRequest();
}

export function useRemoveChatCommandGroupMemberRequest() {
  return useEngineGateway().commands.useRemoveGroupMemberRequest();
}
