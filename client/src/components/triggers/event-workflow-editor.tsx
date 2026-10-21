import type { Doc, Id } from "@convex/_generated/dataModel";
import { Loader2, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { FieldOptionsLoader } from "@/components/triggers/field-options-loader";
import { SaveState } from "@/components/triggers/save-state";
import { TriggerCard } from "@/components/triggers/trigger-card";
import { Button } from "@/components/ui/button";
import {
  useCreateWorkflowRequest,
  useSetWorkflowEnabledRequest,
  useUpdateWorkflowRequest,
} from "@/engine/hooks/use-workflows";
import { useEventWorkflowDraft } from "@/hooks/use-event-workflow-draft";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useNotRunningWorkflows } from "@/hooks/use-workflow-health";
import { alertEditorPath } from "@/lib/alert-editor-route";
import { type OptionLabels, sentenceParts } from "@/lib/condition-sentence";
import { type EventEditorState, isDraftDirty, setDraft, updateDraftValue } from "@/lib/event-drafts";
import { conditionFieldsOf, newProjectedAction, usedTaskIds, withNewTrigger } from "@/lib/event-workflow-state";
import { isInternalSource } from "@/lib/parse-config-fields";
import { firstIncompleteTrigger, saveEventDraft } from "@/lib/save-event-draft";
import { nextTaskId, type ProjectedAction, type ProjectedTrigger } from "@/lib/trigger-projection";
import type { ActionPreset, TriggerPreset } from "@/lib/workflow-presets";

interface EventWorkflowEditorProps {
  triggerPreset: TriggerPreset;
  actionPresets: ActionPreset[];
  /** The workflow holding the event's triggers together, as the only entry. */
  workflows: Doc<"workflows">[];
}

/** A condition value picker that is open, and on which trigger. */
interface OpenField {
  triggerId: string;
  fieldId: string;
}

/**
 * An event's triggers stored together in one workflow, edited as that workflow: a
 * condition task per trigger, its actions in `onTrue` (lib/trigger-projection.ts).
 *
 * Triggers are workflows of their own now (lib/alert-triggers.ts), and the engine splits
 * workflows of this shape into them when it can reproduce what they did exactly. This
 * editor is what still opens the ones it could not, from their card on the trigger list.
 *
 * Edits collect in the event's draft (lib/event-drafts.ts) until Save, including the
 * ones the alert editor hands back, so the page's Save and Discard cover all of them.
 */
export function EventWorkflowEditor({ triggerPreset, actionPresets, workflows }: EventWorkflowEditorProps) {
  const event = triggerPreset.event ?? "";
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const { toast } = useToast();
  const createFromDefinition = useCreateWorkflowRequest();
  const updateFromDefinition = useUpdateWorkflowRequest();
  const setEnabled = useSetWorkflowEnabledRequest();

  const [expandedTriggerId, setExpandedTriggerId] = useState<string | null>(null);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [openField, setOpenField] = useState<OpenField | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadedOptions, setLoadedOptions] = useState<ReadonlyMap<string, LoadedFieldOptions>>(new Map());

  const conditionFields = useMemo(() => conditionFieldsOf(triggerPreset), [triggerPreset]);
  const dynamicFields = useMemo(() => conditionFields.filter(isInternalSource), [conditionFields]);

  const { draft } = useEventWorkflowDraft(triggerPreset, conditionFields, workflows);
  const { byId: notRunning } = useNotRunningWorkflows();

  const state = draft?.value ?? null;
  const isDirty = isDraftDirty(draft);

  const optionLabels = useMemo<OptionLabels>(() => {
    const labels = new Map(
      Array.from(loadedOptions.entries()).map(([fieldId, entry]) => [
        fieldId,
        new Map(entry.options.map((option) => [option.value, option.label])),
      ])
    );
    return labels;
  }, [loadedOptions]);

  const handleOptionsLoaded = useCallback((fieldId: string, entry: LoadedFieldOptions) => {
    setLoadedOptions((previous) => new Map(previous).set(fieldId, entry));
  }, []);

  const resolveActionPreset = useCallback(
    (action: ProjectedAction): ActionPreset | undefined =>
      actionPresets.find((candidate) =>
        action.functionCall
          ? candidate.functionCall === action.functionCall
          : candidate.handlerType === action.handlerType
      ),
    [actionPresets]
  );

  const mutate = (updater: (current: EventEditorState) => EventEditorState) => {
    updateDraftValue(event, updater);
  };

  const mutateTrigger = (triggerId: string, updater: (trigger: ProjectedTrigger) => ProjectedTrigger) => {
    mutate((current) => ({
      ...current,
      triggers: current.triggers.map((trigger) => (trigger.id === triggerId ? updater(trigger) : trigger)),
    }));
  };

  const addTrigger = () => {
    if (!state) {
      return;
    }
    const { state: next, triggerId } = withNewTrigger(state, conditionFields);
    mutate(() => next);
    setExpandedTriggerId(triggerId);
    // A new trigger opens on the first value it still needs, so it never sits unfinished.
    const missing = firstIncompleteTrigger(next, conditionFields);
    setOpenField(missing?.triggerId === triggerId ? { triggerId, fieldId: missing.fields[0].id } : null);
  };

  const addAction = (triggerId: string, preset: ActionPreset) => {
    if (!state) {
      return;
    }
    const id = nextTaskId("act", usedTaskIds(state));
    mutateTrigger(triggerId, (trigger) => ({
      ...trigger,
      actions: [...trigger.actions, newProjectedAction(id, preset)],
    }));
    setExpandedActionId(id);
  };

  const removeTrigger = (triggerId: string) => {
    mutate((current) => ({
      ...current,
      triggers: current.triggers.filter((t) => t.id !== triggerId),
      shared: current.shared
        .map((s) => ({ ...s, triggerIds: s.triggerIds.filter((id) => id !== triggerId) }))
        .filter((s) => s.triggerIds.length > 0),
    }));
  };

  const removeAction = (triggerId: string, actionId: string) => {
    mutate((current) => ({
      ...current,
      triggers: current.triggers.map((t) =>
        t.id === triggerId ? { ...t, actions: t.actions.filter((a) => a.id !== actionId) } : t
      ),
      // A shared action loses an owner with it; one with none left goes too.
      shared: current.shared
        .map((s) => ({ ...s, triggerIds: s.triggerIds.filter((id) => id !== actionId) }))
        .filter((s) => s.triggerIds.length > 0),
    }));
  };

  const handleDiscard = () => {
    if (!draft) {
      return;
    }
    setDraft(event, { value: JSON.parse(draft.baseline) as EventEditorState, baseline: draft.baseline });
    setOpenField(null);
  };

  async function handleSave() {
    if (!instance || !state) {
      return;
    }
    const incomplete = firstIncompleteTrigger(state, conditionFields);
    if (incomplete) {
      setOpenField({ triggerId: incomplete.triggerId, fieldId: incomplete.fields[0].id });
      toast({
        title: "A trigger isn't finished",
        description: `Choose ${incomplete.fields.map((field) => field.label.toLowerCase()).join(", ")}, or pick Any.`,
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      const { enabled } = await saveEventDraft(event, state, conditionFields, {
        instanceId: instance._id as Id<"instances">,
        createFromDefinition,
        updateFromDefinition,
        setEnabled,
      });
      if (!enabled) {
        toast({
          title: "Saved, but not enabled",
          description: "Enable the workflow from the Workflows screen.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  const shown = state?.triggers ?? [];
  const count = shown.length;

  return (
    <section className="flex flex-col gap-4" data-testid={`event-editor-${event}`}>
      {dynamicFields.map((field) => (
        <FieldOptionsLoader key={field.id} field={field} onLoaded={handleOptionsLoaded} />
      ))}

      {!state ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 px-1">
            <span className="text-[13px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              {count === 1 ? "1 trigger" : `${count} triggers`}
            </span>
            <Button variant="outline" className="h-11 sm:h-9" onClick={addTrigger} data-testid={`add-trigger-${event}`}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add a trigger here
            </Button>
          </div>

          {count === 0 ? (
            <div className="flex flex-col items-center gap-3.5 rounded-2xl border border-dashed px-6 py-14 text-center">
              <p className="text-base font-medium">No triggers yet</p>
              <p className="max-w-[360px] text-sm text-muted-foreground">
                Set the conditions and decide what happens when this event fires.
              </p>
              <Button variant="outline" className="h-11 sm:h-10" onClick={addTrigger}>
                Create your first trigger
              </Button>
            </div>
          ) : (
            shown.map((trigger) => {
              const values = state.conditionValues[trigger.id] ?? {};
              return (
                <TriggerCard
                  key={trigger.id}
                  trigger={trigger}
                  triggerPreset={triggerPreset}
                  actionPresets={actionPresets}
                  conditionFields={conditionFields}
                  conditionValues={values}
                  sentence={sentenceParts(triggerPreset.sentence, conditionFields, values, optionLabels)}
                  loadedOptions={loadedOptions}
                  openFieldId={openField?.triggerId === trigger.id ? openField.fieldId : null}
                  isExpanded={expandedTriggerId === trigger.id}
                  expandedActionId={expandedActionId}
                  alertEditorHref={(actionId) => alertEditorPath({ event, triggerId: trigger.id, actionId })}
                  onOpenFieldChange={(fieldId) =>
                    setOpenField(fieldId === null ? null : { triggerId: trigger.id, fieldId })
                  }
                  onToggleExpanded={() => setExpandedTriggerId(expandedTriggerId === trigger.id ? null : trigger.id)}
                  onExpandAction={setExpandedActionId}
                  onChangeConditionValue={(fieldId, value) =>
                    mutate((current) => ({
                      ...current,
                      conditionValues: {
                        ...current.conditionValues,
                        [trigger.id]: { ...(current.conditionValues[trigger.id] ?? {}), [fieldId]: value as never },
                      },
                    }))
                  }
                  onToggleEnabled={() => mutateTrigger(trigger.id, (t) => ({ ...t, enabled: !t.enabled }))}
                  onChangeActionParameters={(actionId, parameters) =>
                    mutateTrigger(trigger.id, (t) => ({
                      ...t,
                      actions: t.actions.map((a) => (a.id === actionId ? { ...a, parameters } : a)),
                    }))
                  }
                  onToggleActionConcurrent={(actionId) =>
                    mutateTrigger(trigger.id, (t) => ({
                      ...t,
                      actions: t.actions.map((a) =>
                        a.id === actionId ? { ...a, concurrentWithPrevious: !a.concurrentWithPrevious } : a
                      ),
                    }))
                  }
                  onRemoveAction={(actionId) => removeAction(trigger.id, actionId)}
                  onAddAction={(preset) => addAction(trigger.id, preset)}
                  onRemove={() => removeTrigger(trigger.id)}
                  onOpenInWorkflowEditor={
                    state.engineWorkflowId ? () => navigate(`/stream/workflows/${state.engineWorkflowId}`) : undefined
                  }
                  resolveActionPreset={resolveActionPreset}
                  notRunning={state.engineWorkflowId ? notRunning.get(state.engineWorkflowId) : undefined}
                />
              );
            })
          )}

          <SaveState isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
        </div>
      )}
    </section>
  );
}
