import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { CommandsGateway } from "@/engine/gateway";
import type {
  ChatCommandChanges,
  ChatCommandGroupChanges,
  InstanceId,
  NewChatCommand,
  NewChatCommandGroup,
} from "@/engine/types";

function useCommands(instanceId: InstanceId | null) {
  return useQuery(api.chatCommands.list, instanceId ? { instanceId } : "skip");
}

function useGroups(instanceId: InstanceId | null) {
  return useQuery(api.chatCommandGroups.list, instanceId ? { instanceId } : "skip");
}

function useGroupMembers(instanceId: InstanceId, engineGroupId: string) {
  return useQuery(api.chatCommandGroups.listMembers, { instanceId, engineGroupId });
}

function useCreateCommandRequest() {
  const createCommand = useAction(api.chatCommandActions.createCommand);
  return useCallback(
    (instanceId: InstanceId, command: NewChatCommand) => createCommand({ instanceId, ...command }),
    [createCommand]
  );
}

function useUpdateCommandRequest() {
  const updateCommand = useAction(api.chatCommandActions.updateCommand);
  return useCallback(
    (instanceId: InstanceId, command: ChatCommandChanges) => updateCommand({ instanceId, ...command }),
    [updateCommand]
  );
}

function useDeleteCommandRequest() {
  const deleteCommand = useAction(api.chatCommandActions.deleteCommand);
  return useCallback(
    (instanceId: InstanceId, engineCommandId: string) => deleteCommand({ instanceId, engineCommandId }),
    [deleteCommand]
  );
}

function useCreateGroupRequest() {
  const createGroup = useAction(api.chatCommandActions.createGroup);
  return useCallback(
    (instanceId: InstanceId, group: NewChatCommandGroup) => createGroup({ instanceId, ...group }),
    [createGroup]
  );
}

function useUpdateGroupRequest() {
  const updateGroup = useAction(api.chatCommandActions.updateGroup);
  return useCallback(
    (instanceId: InstanceId, group: ChatCommandGroupChanges) => updateGroup({ instanceId, ...group }),
    [updateGroup]
  );
}

function useDeleteGroupRequest() {
  const deleteGroup = useAction(api.chatCommandActions.deleteGroup);
  return useCallback(
    (instanceId: InstanceId, engineGroupId: string) => deleteGroup({ instanceId, engineGroupId }),
    [deleteGroup]
  );
}

function useAddGroupMemberRequest() {
  const addUserToGroup = useAction(api.chatCommandActions.addUserToGroup);
  return useCallback(
    (instanceId: InstanceId, engineGroupId: string, username: string) =>
      addUserToGroup({ instanceId, engineGroupId, username }),
    [addUserToGroup]
  );
}

function useRemoveGroupMemberRequest() {
  const removeUserFromGroup = useAction(api.chatCommandActions.removeUserFromGroup);
  return useCallback(
    (instanceId: InstanceId, engineGroupId: string, username: string) =>
      removeUserFromGroup({ instanceId, engineGroupId, username }),
    [removeUserFromGroup]
  );
}

export const convexCommandsGateway: CommandsGateway = {
  useCommands,
  useGroups,
  useGroupMembers,
  useCreateCommandRequest,
  useUpdateCommandRequest,
  useDeleteCommandRequest,
  useCreateGroupRequest,
  useUpdateGroupRequest,
  useDeleteGroupRequest,
  useAddGroupMemberRequest,
  useRemoveGroupMemberRequest,
};
