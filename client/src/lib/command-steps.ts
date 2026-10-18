import type { ActionStep, TaskDefinition, WorkflowDefinition } from "@woofx3/api";
import { commandNameToSubjectSegment } from "@/lib/command-slug";
import { definitionToTree, treeToDefinition, type WorkflowTree } from "@/lib/workflow-tree";

/**
 * A chat command's steps as the flow editor holds them, or why they can't be edited there.
 *
 * A command's steps are the tasks of a stored workflow of its own, whose trigger has type
 * "command": only the command starts it (see docs/services/commands-ui.md in the woofx3
 * engine repo). The editor reads those tasks into a WorkflowTree like any workflow's, and a
 * save sends the tree's tasks back as the command's `steps`.
 */
export type CommandFlow = { editable: true; tree: WorkflowTree } | { editable: false; reason: string };

/**
 * The trigger of the workflow command `commandWord` runs. Its `event` is what the run reads
 * as `${trigger...}`, which is how a step offers the chatter's name and the arguments.
 */
export function commandTrigger(commandWord: string): { type: "command"; event: string } {
  return { type: "command", event: `chat.command.${commandSegment(commandWord)}` };
}

/** The subject segment of a command word, or a placeholder while the word can't be one yet. */
function commandSegment(commandWord: string): string {
  try {
    return commandNameToSubjectSegment(commandWord);
  } catch {
    return "_";
  }
}

/**
 * Actions run in order, as the tasks of a workflow: each gets an id and the type "action"
 * when it has none, and waits for the one before it unless it says what it waits for.
 * Mirrors chainActions in db/app/services/command_workflow.go, which is how the engine
 * turns the same list into the command's workflow.
 */
export function chainActions(actions: readonly ActionStep[]): TaskDefinition[] {
  const tasks: TaskDefinition[] = [];
  actions.forEach((action, index) => {
    const id = action.id || `action-${index + 1}`;
    const previous = tasks[index - 1];
    const task: TaskDefinition = {
      ...(action as unknown as TaskDefinition),
      id,
      type: (action as { type?: TaskDefinition["type"] }).type || "action",
    };
    if ((action.dependsOn === undefined || action.dependsOn.length === 0) && previous) {
      task.dependsOn = [previous.id];
    }
    tasks.push(task);
  });
  return tasks;
}

/**
 * A command's steps opened for editing. A command with a workflow has `steps`; one the
 * engine has not linked to a workflow yet still has `actions`, which open as the steps the
 * engine would make of them, so saving it links it.
 */
export function commandFlow(
  commandWord: string,
  steps: readonly TaskDefinition[],
  actions: readonly ActionStep[]
): CommandFlow {
  const tasks = steps.length > 0 ? [...steps] : chainActions(actions);
  const definition: WorkflowDefinition = {
    id: "command",
    name: `!${commandWord}`,
    trigger: commandTrigger(commandWord),
    tasks,
  };
  const result = definitionToTree(definition);
  return result.editable ? { editable: true, tree: result.tree } : { editable: false, reason: result.message };
}

/** The tasks a save sends as the command's `steps`. */
export function commandSteps(tree: WorkflowTree): TaskDefinition[] {
  return treeToDefinition(tree).tasks;
}
