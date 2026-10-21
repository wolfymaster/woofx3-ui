import { useEngineGateway } from "@/engine/context";

/** The instance's chat commands. */
export function useChatCommands() {
  return useEngineGateway().commands.useCommands();
}

/** The instance's chat command groups. */
export function useChatCommandGroups() {
  return useEngineGateway().commands.useGroups();
}

/** The usernames in one chat command group. */
export function useChatCommandGroupMembers(engineGroupId: string) {
  return useEngineGateway().commands.useGroupMembers(engineGroupId);
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
