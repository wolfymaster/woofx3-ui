import type { ActionStep } from "@woofx3/api";

export type CommandVisibility = "public" | "restricted";

/** What the command editor edits: one chat command, in the shape its form works in. */
export interface CommandEditorState {
  /** The command word and its argument pattern as one field — see lib/command-input.ts. */
  command: string;
  actions: ActionStep[];
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: CommandVisibility;
  groupIds: string[];
  usernames: string[];
}

/** A command's unsaved edits, and the snapshot they started from. */
export interface CommandDraft {
  value: CommandEditorState;
  baseline: string;
}

/** What a command being created is keyed under, before the engine has given it an id. */
export const NEW_COMMAND_KEY = "new";

/**
 * How a step is addressed within its command — in the editor's row keys, in the route of
 * the step's own alert editor, and in the `${stepId.field}` references later steps make
 * to its output. A step written before ids were assigned has none, so its position stands
 * in, named as the engine names it (sequentialTasks in workflow/internal/engine/
 * actions_run.go) — otherwise a reference to that step would never resolve.
 */
export function commandStepId(step: ActionStep, index: number): string {
  return step.id ?? `action-${index + 1}`;
}

export const emptyCommand: CommandEditorState = {
  command: "",
  actions: [],
  cooldown: 5,
  priority: 0,
  enabled: true,
  visibility: "public",
  groupIds: [],
  usernames: [],
};

/**
 * Drafts live outside any component, keyed by engine command id (or NEW_COMMAND_KEY),
 * because editing a step's alert content leaves the command editor for its own route.
 * A draft held in page state would be lost on the way there, and the alert editor's Done
 * hands its change back to this draft rather than saving, so the page's Save covers it
 * like any other edit.
 *
 * Nothing is persisted: a reload starts again from the engine's copy. A draft is dropped
 * on Save and on leaving the editor, so reopening a command always shows what is stored.
 */
const drafts = new Map<string, CommandDraft>();
const listeners = new Set<() => void>();

export function subscribeToCommandDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCommandDraft(key: string): CommandDraft | undefined {
  return drafts.get(key);
}

export function setCommandDraft(key: string, next: CommandDraft): void {
  if (!key) {
    throw new Error("a draft needs the command it belongs to");
  }
  drafts.set(key, next);
  notify();
}

export function clearCommandDraft(key: string): void {
  if (drafts.delete(key)) {
    notify();
  }
}

export function isCommandDraftDirty(draft: CommandDraft | undefined): boolean {
  return draft !== undefined && JSON.stringify(draft.value) !== draft.baseline;
}

/** Applies `update` to the draft's value, leaving its baseline where it was. */
export function updateCommandDraft(key: string, update: (value: CommandEditorState) => CommandEditorState): void {
  const current = drafts.get(key);
  if (!current) {
    throw new Error(`no draft is open for command "${key}"`);
  }
  setCommandDraft(key, { ...current, value: update(current.value) });
}

function notify(): void {
  for (const listener of Array.from(listeners)) {
    listener();
  }
}
