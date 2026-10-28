import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback } from "react";
import type { CommandsGateway } from "@/engine/gateway";
import type {
  ChatCommand,
  ChatCommandChanges,
  ChatCommandGroup,
  ChatCommandGroupChanges,
  NewChatCommand,
  NewChatCommandGroup,
} from "@/engine/types";
import { useMappedList } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

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
  };
}

function toChatCommandGroup(row: Doc<"chatCommandGroups">): ChatCommandGroup {
  return {
    engineGroupId: row.engineGroupId,
    name: row.name,
    description: row.description,
    isBuiltIn: row.isBuiltIn,
    engineCreatedAt: row.engineCreatedAt,
  };
}

function useCommands() {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.chatCommands.list, instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toChatCommand);
}

function useGroups() {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.chatCommandGroups.list, instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toChatCommandGroup);
}

function useGroupMembers(engineGroupId: string) {
  const instanceId = useScopeInstanceId();
  return useQuery(api.chatCommandGroups.listMembers, instanceId ? { instanceId, engineGroupId } : "skip");
}

function useCreateCommandRequest() {
  const createCommand = useInstanceAction(api.chatCommandActions.createCommand);
  return useCallback((command: NewChatCommand) => createCommand(command), [createCommand]);
}

function useUpdateCommandRequest() {
  const updateCommand = useInstanceAction(api.chatCommandActions.updateCommand);
  return useCallback((command: ChatCommandChanges) => updateCommand(command), [updateCommand]);
}

function useDeleteCommandRequest() {
  const deleteCommand = useInstanceAction(api.chatCommandActions.deleteCommand);
  return useCallback((engineCommandId: string) => deleteCommand({ engineCommandId }), [deleteCommand]);
}

function useCreateGroupRequest() {
  const createGroup = useInstanceAction(api.chatCommandActions.createGroup);
  return useCallback((group: NewChatCommandGroup) => createGroup(group), [createGroup]);
}

function useUpdateGroupRequest() {
  const updateGroup = useInstanceAction(api.chatCommandActions.updateGroup);
  return useCallback((group: ChatCommandGroupChanges) => updateGroup(group), [updateGroup]);
}

function useDeleteGroupRequest() {
  const deleteGroup = useInstanceAction(api.chatCommandActions.deleteGroup);
  return useCallback((engineGroupId: string) => deleteGroup({ engineGroupId }), [deleteGroup]);
}

function useAddGroupMemberRequest() {
  const addUserToGroup = useInstanceAction(api.chatCommandActions.addUserToGroup);
  return useCallback(
    (engineGroupId: string, username: string) => addUserToGroup({ engineGroupId, username }),
    [addUserToGroup]
  );
}

function useRemoveGroupMemberRequest() {
  const removeUserFromGroup = useInstanceAction(api.chatCommandActions.removeUserFromGroup);
  return useCallback(
    (engineGroupId: string, username: string) => removeUserFromGroup({ engineGroupId, username }),
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
