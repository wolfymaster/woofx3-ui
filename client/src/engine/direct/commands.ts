import type { CommandsGateway } from "@/engine/gateway";
import type {
  ChatCommand,
  ChatCommandChanges,
  ChatCommandGroup,
  ChatCommandGroupChanges,
  NewChatCommand,
  NewChatCommandGroup,
} from "@/engine/types";
import { directKeys as k } from "./keys";
import { normalizeUsername, toChatCommand, toChatCommandGroup, toCommandInput } from "./map/commands";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

export function commandsRead(runtime: DirectRuntime): EngineRead<ChatCommand[]> {
  return {
    queryKey: k.commands.list(),
    queryFn: async () => (await runtime.call("listCommands", (api) => api.listCommands())).map(toChatCommand),
  };
}

function groupsRead(runtime: DirectRuntime): EngineRead<ChatCommandGroup[]> {
  return {
    queryKey: k.commands.groups(),
    queryFn: async () => (await runtime.call("listGroups", (api) => api.listGroups())).map(toChatCommandGroup),
  };
}

function membersRead(runtime: DirectRuntime, engineGroupId: string): EngineRead<string[]> {
  return {
    queryKey: k.commands.members(engineGroupId),
    queryFn: () => runtime.call("listGroupMembers", (api) => api.listGroupMembers(engineGroupId)),
  };
}

/**
 * Commands and groups read from the engine and kept current by its
 * `command.*` and `group.*` events. A write resolves once the engine has
 * answered and its own reads are marked stale; it does not wait for the
 * event, which may never arrive.
 */
export function directCommandsGateway(runtime: DirectRuntime): CommandsGateway {
  const invalidate = (...queryKeys: (readonly unknown[])[]) =>
    Promise.all(queryKeys.map((queryKey) => runtime.queryClient.invalidateQueries({ queryKey })));
  const correlationKey = () => crypto.randomUUID();

  const createCommand = async (command: NewChatCommand) => {
    const created = await runtime.call("createCommand", (api) =>
      api.createCommand({ ...toCommandInput(command), correlationKey: correlationKey() })
    );
    await invalidate(k.commands.list(), k.scenes.allAlertTargetUsage);
    return { engineCommandId: created.id };
  };

  const updateCommand = async ({ engineCommandId, ...command }: ChatCommandChanges) => {
    const updated = await runtime.call("updateCommand", (api) =>
      api.updateCommand(engineCommandId, {
        ...toCommandInput(command),
        priority: command.priority,
        correlationKey: correlationKey(),
      })
    );
    await invalidate(k.commands.list(), k.scenes.allAlertTargetUsage);
    return { engineCommandId: updated.id };
  };

  const deleteCommand = async (engineCommandId: string) => {
    const result = await runtime.call("deleteCommand", (api) => api.deleteCommand(engineCommandId, correlationKey()));
    await invalidate(k.commands.list(), k.scenes.allAlertTargetUsage);
    return { deleted: result.deleted };
  };

  const createGroup = async (group: NewChatCommandGroup) => {
    const created = await runtime.call("createGroup", (api) =>
      api.createGroup({ name: group.name, description: group.description, correlationKey: correlationKey() })
    );
    await invalidate(k.commands.groups());
    return { engineGroupId: created.id };
  };

  const updateGroup = async (group: ChatCommandGroupChanges) => {
    const updated = await runtime.call("updateGroup", (api) =>
      api.updateGroup(group.engineGroupId, {
        name: group.name,
        description: group.description,
        correlationKey: correlationKey(),
      })
    );
    await invalidate(k.commands.groups());
    return { engineGroupId: updated.id };
  };

  const deleteGroup = async (engineGroupId: string) => {
    const result = await runtime.call("deleteGroup", (api) => api.deleteGroup(engineGroupId, correlationKey()));
    await invalidate(k.commands.groups(), k.commands.members(engineGroupId));
    return { deleted: result.deleted };
  };

  const addMember = async (engineGroupId: string, username: string) => {
    const result = await runtime.call("addUserToGroup", (api) =>
      api.addUserToGroup(engineGroupId, normalizeUsername(username))
    );
    await invalidate(k.commands.members(engineGroupId));
    return result;
  };

  const removeMember = async (engineGroupId: string, username: string) => {
    const result = await runtime.call("removeUserFromGroup", (api) =>
      api.removeUserFromGroup(engineGroupId, normalizeUsername(username))
    );
    await invalidate(k.commands.members(engineGroupId));
    return result;
  };

  return {
    useCommands: () => useEngineQuery(runtime, commandsRead(runtime)),
    useGroups: () => useEngineQuery(runtime, groupsRead(runtime)),
    useGroupMembers: (engineGroupId) => useEngineQuery(runtime, membersRead(runtime, engineGroupId)),
    useCreateCommandRequest: () => useEngineRequest(createCommand),
    useUpdateCommandRequest: () => useEngineRequest(updateCommand),
    useDeleteCommandRequest: () => useEngineRequest(deleteCommand),
    useCreateGroupRequest: () => useEngineRequest(createGroup),
    useUpdateGroupRequest: () => useEngineRequest(updateGroup),
    useDeleteGroupRequest: () => useEngineRequest(deleteGroup),
    useAddGroupMemberRequest: () => useEngineRequest(addMember),
    useRemoveGroupMemberRequest: () => useEngineRequest(removeMember),
  };
}
