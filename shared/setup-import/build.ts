import type {
  ImportActionStep,
  ImportCommandSpec,
  ImportItem,
  ImportNote,
  ImportStep,
  ImportWorkflowSpec,
} from "./types";

/** Add a note once: the same problem in several steps is one line in the report. */
export function pushNote(notes: ImportNote[], note: ImportNote): void {
  const existing = notes.find((candidate) => candidate.message === note.message);
  if (!existing) {
    notes.push(note);
    return;
  }
  if (note.blocking === true) {
    existing.blocking = true;
  }
  if (note.detail !== undefined && existing.detail === undefined) {
    existing.detail = note.detail;
  }
}

export const NOTHING_TO_RUN = "Nothing it does can run on woofx3 yet.";

export function onlyActions(steps: readonly ImportStep[]): steps is ImportActionStep[] {
  return steps.every((step) => step.kind === "action");
}

interface ItemBase {
  key: string;
  name: string;
  origin: string;
  notes: ImportNote[];
}

/**
 * A chat command, and the workflow that runs it when its steps need more than a
 * command can hold. A command runs a plain list of actions; a delay or an
 * if/else needs a workflow, which binds to the command's chat event the way one
 * built in the workflow builder does, while the command itself keeps the
 * cooldown and who may use it.
 */
export function commandItems(
  base: ItemBase,
  spec: Omit<ImportCommandSpec, "steps">,
  steps: ImportStep[]
): ImportItem[] {
  if (steps.length === 0) {
    pushNote(base.notes, { message: NOTHING_TO_RUN, blocking: true });
  }
  if (onlyActions(steps)) {
    return [{ ...base, kind: "command", spec: { ...spec, steps } }];
  }
  const command: ImportItem = { ...base, kind: "command", spec: { ...spec, steps: [] } };
  const workflow: ImportItem = {
    key: `${base.key}:workflow`,
    name: `!${spec.command}`,
    origin: base.origin,
    // The command carries the report's notes; the workflow is its other half.
    notes: base.notes.filter((note) => note.blocking === true),
    kind: "workflow",
    spec: {
      name: `!${spec.command}`,
      description: `Runs the !${spec.command} chat command.`,
      enabled: spec.enabled,
      trigger: { kind: "event", event: `chat.command.${spec.command}`, conditions: [], logic: "and" },
      steps,
      commandKey: base.key,
    },
  };
  return [command, workflow];
}

export function workflowItem(base: ItemBase, spec: ImportWorkflowSpec): ImportItem {
  if (spec.steps.length === 0) {
    pushNote(base.notes, { message: NOTHING_TO_RUN, blocking: true });
  }
  return { ...base, kind: "workflow", spec };
}

/** Every step, nested ones included, in the order they run. */
export function flattenSteps(steps: readonly ImportStep[]): ImportStep[] {
  const out: ImportStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.kind === "branch") {
      out.push(...flattenSteps(step.whenTrue), ...flattenSteps(step.whenFalse));
    }
  }
  return out;
}
