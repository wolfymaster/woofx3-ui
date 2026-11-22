import type { TaskDefinition, WorkflowDefinition } from "@woofx3/api";
import { type EventTrigger, triggerFieldValues } from "@/lib/alert-triggers";
import type { ConfigField } from "@/lib/workflow-presets";

/** The trigger a schedule's workflows run on; the module declares it as `schedule_fired`. */
export const SCHEDULE_FIRED_EVENT = "schedule.fired";

/** The engine's built-in action that runs a chat command's steps. */
export const COMMAND_RUN_ACTION_REF = "woofx3:action:command.run";

/** What `step.action` carries on a stored step of that action. */
export const COMMAND_RUN_HANDLER = "command.run";

/** Bounds of a schedule's `interval` setting, in minutes; must match the schedule kind in the woofx3 module manifest. */
export const SCHEDULE_MIN_MINUTES = 1;
export const SCHEDULE_MAX_MINUTES = 40320;

/** Where a command's schedule stands in the editor: as stored, or as the streamer changed it. */
export type ScheduleChoice =
  | { kind: "none" }
  | { kind: "existing"; canonicalId: string }
  | { kind: "new"; name: string; minutes: number; runWhileOffline: boolean };

/** A schedule trigger that runs a command, and the schedule it is pinned to. */
export interface CommandScheduleLink {
  trigger: EventTrigger;
  /** The schedule's canonical id; null when the trigger runs on every schedule. */
  canonicalId: string | null;
}

/** A command's word as steps name it: no leading "!", lowercase. */
export function bareCommandWord(name: string): string {
  return name.trim().replace(/^!/, "").toLowerCase();
}

/** Whether the workflow has a step that runs the command `word`. */
export function runsCommand(definition: WorkflowDefinition, word: string): boolean {
  const target = bareCommandWord(word);
  return (definition.tasks ?? []).some(
    (task) =>
      task.type === "action" &&
      task.action === COMMAND_RUN_HANDLER &&
      typeof task.parameters?.command === "string" &&
      bareCommandWord(task.parameters.command) === target
  );
}

/** Whether running the command is all the workflow does, which is what the command editor may remove. */
export function onlyRunsCommand(definition: WorkflowDefinition, word: string): boolean {
  return (definition.tasks ?? []).length === 1 && runsCommand(definition, word);
}

/**
 * The schedule triggers that only run `word`, found by the step they hold rather than by
 * a name, so a workflow made in the builder counts as much as one made here. A workflow
 * that does more than run the command is the builder's to edit and is not listed.
 */
export function commandScheduleLinks(
  triggers: readonly EventTrigger[],
  fields: ConfigField[],
  pinFieldId: string,
  word: string
): CommandScheduleLink[] {
  return triggers
    .filter((trigger) => onlyRunsCommand(trigger.definition, word))
    .map((trigger) => {
      const pinned = triggerFieldValues(trigger.conditions, fields)[pinFieldId];
      return { trigger, canonicalId: typeof pinned === "string" && pinned !== "" ? pinned : null };
    });
}

/** The definition with its steps that run `from` running `to` instead, for a renamed command. */
export function withCommandWord(definition: WorkflowDefinition, from: string, to: string): WorkflowDefinition {
  const source = bareCommandWord(from);
  const tasks = (definition.tasks ?? []).map((task: TaskDefinition): TaskDefinition => {
    const runsSource =
      task.type === "action" &&
      task.action === COMMAND_RUN_HANDLER &&
      typeof task.parameters?.command === "string" &&
      bareCommandWord(task.parameters.command) === source;
    return runsSource ? { ...task, parameters: { ...task.parameters, command: to } } : task;
  });
  return { ...definition, tasks };
}

/** What stops a schedule choice from being saved, or null. */
export function scheduleChoiceProblem(choice: ScheduleChoice): string | null {
  if (choice.kind !== "new") {
    return null;
  }
  if (choice.name.trim() === "") {
    return "Name the new schedule.";
  }
  const { minutes } = choice;
  if (!Number.isInteger(minutes) || minutes < SCHEDULE_MIN_MINUTES || minutes > SCHEDULE_MAX_MINUTES) {
    return `A schedule runs every ${SCHEDULE_MIN_MINUTES} to ${SCHEDULE_MAX_MINUTES.toLocaleString()} minutes.`;
  }
  return null;
}
