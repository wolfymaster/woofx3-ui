import type { Doc } from "@convex/_generated/dataModel";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { useEffect, useMemo } from "react";
import { useEventDraft } from "@/hooks/use-event-draft";
import { type EventDraft, type EventEditorState, getDraft, isDraftDirty, setDraft } from "@/lib/event-drafts";
import { projectWorkflow } from "@/lib/trigger-projection";
import type { TriggerPreset } from "@/lib/workflow-presets";
import { conditionsToFieldValues } from "@/lib/workflow-presets-json";

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

  const matching = useMemo(
    () =>
      (workflows ?? []).filter((row) => {
        const projected = projectWorkflow(row);
        return projected.ok ? projected.projection.event === event : rowEvent(row) === event;
      }),
    [workflows, event]
  );

  // The first projectable workflow is the one this page edits. Others on the same
  // event are left alone and pointed at the builder rather than silently merged.
  const primary = matching.find((row) => projectWorkflow(row).ok);
  const others = matching.filter((row) => row !== primary);
  const unprojectable = matching.find((row) => !projectWorkflow(row).ok);

  const loaded = useMemo<EventEditorState | undefined>(() => {
    if (!triggerPreset || workflows === undefined) {
      return undefined;
    }
    const projected = primary ? projectWorkflow(primary) : undefined;
    if (projected?.ok === true) {
      const { projection } = projected;
      return {
        engineWorkflowId: projection.engineWorkflowId,
        name: projection.name,
        triggers: projection.triggers,
        shared: projection.shared,
        conditionValues: Object.fromEntries(
          projection.triggers.map((trigger) => [
            trigger.id,
            conditionsToFieldValues(conditionFields, trigger.conditions),
          ])
        ),
      };
    }
    return { name: `${triggerPreset.name} triggers`, triggers: [], shared: [], conditionValues: {} };
  }, [primary, conditionFields, triggerPreset, workflows]);

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

function rowEvent(row: Doc<"workflows">): string | undefined {
  const definition = row.definition as { trigger?: { event?: string } } | undefined;
  return definition?.trigger?.event;
}
