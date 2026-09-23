import type { Doc } from "@convex/_generated/dataModel";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { useEffect, useMemo } from "react";
import { useEventDraft } from "@/hooks/use-event-draft";
import { type EventDraft, type EventEditorState, getDraft, isDraftDirty, setDraft } from "@/lib/event-drafts";
import { eventEditorStateFor, eventWorkflowTarget } from "@/lib/event-workflow-state";
import type { TriggerPreset } from "@/lib/workflow-presets";

export interface EventWorkflowDraft {
  draft: EventDraft | undefined;
  /** The workflow's other copies on this event, which this page leaves alone. */
  others: Doc<"workflows">[];
  /** A workflow on this event this page can't project, if there is one. */
  unprojectable: Doc<"workflows"> | undefined;
}

/**
 * The event's draft, opened from its workflow when there isn't one yet. Shared by the
 * triggers page and the alert editor, so a deep link straight to the editor builds the
 * same draft the page would have.
 *
 * The engine's copy is adopted whenever it changes, so an edit made in the workflow
 * builder shows up here — unless the draft has unsaved edits, which win.
 */
export function useEventWorkflowDraft(
  triggerPreset: TriggerPreset | undefined,
  conditionFields: ConfigField[],
  workflows: Doc<"workflows">[] | undefined
): EventWorkflowDraft {
  const event = triggerPreset?.event ?? "";
  const draft = useEventDraft(event);

  const { others, unprojectable } = useMemo(() => eventWorkflowTarget(workflows, event), [workflows, event]);

  const loaded = useMemo<EventEditorState | undefined>(() => {
    if (!triggerPreset || workflows === undefined) {
      return undefined;
    }
    return eventEditorStateFor(workflows, triggerPreset, conditionFields);
  }, [conditionFields, triggerPreset, workflows]);

  const loadedSnapshot = useMemo(() => (loaded ? JSON.stringify(loaded) : undefined), [loaded]);

  useEffect(() => {
    if (!event || !loaded || loadedSnapshot === undefined) {
      return;
    }
    const current = getDraft(event);
    if (current && (isDraftDirty(current) || current.baseline === loadedSnapshot)) {
      return;
    }
    setDraft(event, { value: loaded, baseline: loadedSnapshot });
  }, [event, loaded, loadedSnapshot]);

  return { draft, others, unprojectable };
}
