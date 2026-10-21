import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { CommandsGateway } from "@/engine/gateway";
import type {
  ChatCommand,
  ChatCommandChanges,
  ChatCommandGroup,
  ChatCommandGroupChanges,
  InstanceId,
  NewChatCommand,
  NewChatCommandGroup,
} from "@/engine/types";
import { fromInstanceId } from "./ids";
import { useMappedList } from "./mapped";

function toChatCommand(row: Doc<"chatCommands">): ChatCommand {
  return {
    engineCommandId: row.engineCommandId,
    command: row.command,
    actions: row.actions,
    engineWorkflowId: row.engineWorkflowId,
    steps: row.steps,
    workflowError: row.workflowError,
    argumentPattern: row.argumentPattern,
    cooldown: row.cooldown,
    priority: row.priority,
    enabled: row.enabled,
    visibility: row.visibility,
    groupIds: row.groupIds,
    usernames: row.usernames,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toChatCommandGroup(row: Doc<"chatCommandGroups">): ChatCommandGroup {
  return {
    engineGroupId: row.engineGroupId,
    name: row.name,
    description: row.description,
    isBuiltIn: row.isBuiltIn,
    engineCreatedAt: row.engineCreatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function useCommands(instanceId: InstanceId | null) {
  const rows = useQuery(api.chatCommands.list, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
  return useMappedList(rows, toChatCommand);
}

function useGroups(instanceId: InstanceId | null) {
  const rows = useQuery(api.chatCommandGroups.list, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
  return useMappedList(rows, toChatCommandGroup);
}

function useGroupMembers(instanceId: InstanceId, engineGroupId: string) {
  return useQuery(api.chatCommandGroups.listMembers, { instanceId: fromInstanceId(instanceId), engineGroupId });
}

function useCreateCommandRequest() {
  const createCommand = useAction(api.chatCommandActions.createCommand);
  return useCallback(
    (instanceId: InstanceId, command: NewChatCommand) =>
      createCommand({ instanceId: fromInstanceId(instanceId), ...command }),
    [createCommand]
  );
}

function useUpdateCommandRequest() {
  const updateCommand = useAction(api.chatCommandActions.updateCommand);
  return useCallback(
    (instanceId: InstanceId, command: ChatCommandChanges) =>
      updateCommand({ instanceId: fromInstanceId(instanceId), ...command }),
    [updateCommand]
  );
}

function useDeleteCommandRequest() {
  const deleteCommand = useAction(api.chatCommandActions.deleteCommand);
  return useCallback(
    (instanceId: InstanceId, engineCommandId: string) =>
      deleteCommand({ instanceId: fromInstanceId(instanceId), engineCommandId }),
    [deleteCommand]
  );
}

function useCreateGroupRequest() {
  const createGroup = useAction(api.chatCommandActions.createGroup);
  return useCallback(
    (instanceId: InstanceId, group: NewChatCommandGroup) =>
      createGroup({ instanceId: fromInstanceId(instanceId), ...group }),
    [createGroup]
  );
}

function useUpdateGroupRequest() {
  const updateGroup = useAction(api.chatCommandActions.updateGroup);
  return useCallback(
    (instanceId: InstanceId, group: ChatCommandGroupChanges) =>
      updateGroup({ instanceId: fromInstanceId(instanceId), ...group }),
    [updateGroup]
  );
}

function useDeleteGroupRequest() {
  const deleteGroup = useAction(api.chatCommandActions.deleteGroup);
  return useCallback(
    (instanceId: InstanceId, engineGroupId: string) =>
      deleteGroup({ instanceId: fromInstanceId(instanceId), engineGroupId }),
    [deleteGroup]
  );
}

function useAddGroupMemberRequest() {
  const addUserToGroup = useAction(api.chatCommandActions.addUserToGroup);
  return useCallback(
    (instanceId: InstanceId, engineGroupId: string, username: string) =>
      addUserToGroup({ instanceId: fromInstanceId(instanceId), engineGroupId, username }),
    [addUserToGroup]
  );
}

function useRemoveGroupMemberRequest() {
  const removeUserFromGroup = useAction(api.chatCommandActions.removeUserFromGroup);
  return useCallback(
    (instanceId: InstanceId, engineGroupId: string, username: string) =>
      removeUserFromGroup({ instanceId: fromInstanceId(instanceId), engineGroupId, username }),
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
