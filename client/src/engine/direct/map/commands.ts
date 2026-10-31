import { escapeDollarKeys, unescapeDollarKeys } from "@shared/dollar-keys";
import type { ActionStep, CommandSnapshot, CreateCommandInput, GroupSnapshot } from "@woofx3/api";
import type { TaskDefinition } from "@woofx3/api/workflow-definition";
import type { ChatCommand, ChatCommandGroup, NewChatCommand } from "@/engine/types";

// The gateway's commands carry their `$` keys escaped (shared/dollar-keys), as
// every gateway's do, so a screen edits one shape whichever gateway read it.

export function toChatCommand(snapshot: CommandSnapshot): ChatCommand {
  return {
    engineCommandId: snapshot.id,
    command: snapshot.command,
    actions: escapeDollarKeys(snapshot.actions ?? []) as unknown[],
    engineWorkflowId: snapshot.workflowId || undefined,
    steps: escapeDollarKeys(snapshot.steps ?? []) as unknown[],
    workflowError: snapshot.workflowError || undefined,
    argumentPattern: snapshot.argumentPattern,
    cooldown: snapshot.cooldown,
    priority: snapshot.priority,
    enabled: snapshot.enabled,
    visibility: snapshot.visibility,
    groupIds: snapshot.groupIds ?? [],
    usernames: snapshot.usernames ?? [],
  };
}

export function toChatCommandGroup(snapshot: GroupSnapshot): ChatCommandGroup {
  return {
    engineGroupId: snapshot.id,
    name: snapshot.name,
    description: snapshot.description,
    isBuiltIn: snapshot.isBuiltIn,
    engineCreatedAt: snapshot.createdAt,
  };
}

/**
 * A command's definition as the engine takes it. `steps` wins over
 * `actions` when both are given, since a command with a workflow runs its
 * steps; the `$` keys are unescaped on the way out.
 */
export function toCommandInput(command: NewChatCommand): Omit<CreateCommandInput, "correlationKey"> {
  return {
    command: command.command,
    ...stepsInput(command),
    cooldown: command.cooldown,
    priority: command.priority,
    enabled: command.enabled,
    visibility: command.visibility,
    groupIds: command.groupIds,
    usernames: command.usernames,
    argumentPattern: command.argumentPattern,
  };
}

function stepsInput(command: NewChatCommand): { steps?: TaskDefinition[]; actions?: ActionStep[] } {
  if (command.steps !== undefined) {
    return { steps: unescapeDollarKeys(command.steps) as TaskDefinition[] };
  }
  if (command.actions !== undefined) {
    return { actions: unescapeDollarKeys(command.actions) as ActionStep[] };
  }
  return {};
}

/** A group member's username as the engine stores it. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
