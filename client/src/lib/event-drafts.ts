import type { ProjectedSharedAction, ProjectedTrigger } from "@/lib/trigger-projection";
import type { TriggerConfigValues } from "@/lib/workflow-presets";

/** What the triggers page edits for one event: the projection of its workflow. */
export interface EventEditorState {
  engineWorkflowId?: string;
  name: string;
  triggers: ProjectedTrigger[];
  shared: ProjectedSharedAction[];
  /** Condition values per trigger id, decoded once so editing stays in field space. */
  conditionValues: Record<string, TriggerConfigValues>;
}

/**
 * An event's unsaved edits, and the snapshot they started from: the page has unsaved
 * changes exactly when `value` no longer serializes to `baseline`.
 */
export interface EventDraft {
  value: EventEditorState;
  baseline: string;
}

/**
 * Drafts live outside any component, keyed by event, because editing an alert leaves
 * the triggers page for its own route. A draft held in page state would be lost on the
 * way there, and the alert editor's Done hands its change back to this draft rather
 * than saving, so the page's Save and Discard cover it like any other edit.
 *
 * Nothing is persisted: a reload starts again from the engine's copy.
 */
const drafts = new Map<string, EventDraft>();
const listeners = new Set<() => void>();

export function subscribeToDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDraft(event: string): EventDraft | undefined {
  return drafts.get(event);
}

export function setDraft(event: string, next: EventDraft): void {
  if (!event) {
    throw new Error("a draft needs the event it belongs to");
  }
  drafts.set(event, next);
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

export function isDraftDirty(draft: EventDraft | undefined): boolean {
  return draft !== undefined && JSON.stringify(draft.value) !== draft.baseline;
}

/** Applies `update` to the draft's value, leaving its baseline where it was. */
export function updateDraftValue(event: string, update: (value: EventEditorState) => EventEditorState): void {
  const current = drafts.get(event);
  if (!current) {
    throw new Error(`no draft is open for event "${event}"`);
  }
  setDraft(event, { ...current, value: update(current.value) });
}
