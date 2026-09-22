import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { ChevronRight, Loader2, Plus, Zap } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { FieldOptionsLoader } from "@/components/triggers/field-options-loader";
import { SaveState } from "@/components/triggers/save-state";
import { TriggerCard } from "@/components/triggers/trigger-card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEventWorkflowDraft } from "@/hooks/use-event-workflow-draft";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { alertEditorPath } from "@/lib/alert-editor-route";
import { alertSectionAnchor } from "@/lib/alert-groups";
import { type OptionLabels, sentenceParts } from "@/lib/condition-sentence";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { type EventEditorState, getDraft, isDraftDirty, setDraft, updateDraftValue } from "@/lib/event-drafts";
import { isCommandsSource, isInternalSource } from "@/lib/parse-config-fields";
import {
  buildWorkflowDefinition,
  nextTaskId,
  type ProjectedAction,
  type ProjectedTrigger,
  UNCONDITIONAL_TRIGGER_ID,
} from "@/lib/trigger-projection";
import { cn } from "@/lib/utils";
import { type ActionPreset, getDefaultConfigValues, type TriggerPreset } from "@/lib/workflow-presets";
import { fieldValuesToConditions, incompleteConditionFields } from "@/lib/workflow-presets-json";

interface EventWorkflowEditorProps {
  triggerPreset: TriggerPreset;
  actionPresets: ActionPreset[];
  /** Every workflow on this instance; the ones for this event are found here. */
  workflows: Doc<"workflows">[];
  /** Where this event sits in the Alerts menu, above its own title. */
  breadcrumb: string[];
  /** h1 when the event is the page; h2 when it shares the page with others. */
  headingLevel: "h1" | "h2";
  /** Opens the test sheet on this event; no lightning icon when omitted. */
  onTest?: () => void;
  /** Shows only the triggers pinned to one value of one condition field; see EventScope. */
  scope?: EventScope;
}

/**
 * One condition field held to one value: a resource page edits only the triggers for
 * its own instance ("when Break timer ends"), while the workflow — and so every other
 * instance's triggers — is still the one the Alerts screen would edit. A new trigger
 * starts pinned to the value, and the pinned field reads as text rather than a picker,
 * so it cannot be moved to another instance from here.
 */
export interface EventScope {
  fieldId: string;
  value: string;
  /** What the sentence shows for the value, e.g. the instance's display name. */
  label: string;
}

/** A condition value picker that is open, and on which trigger. */
interface OpenField {
  triggerId: string;
  fieldId: string;
}

/**
 * Every configured trigger for one event, edited as a single workflow.
 *
 * The workflow is the record: this reads one, lets the user add triggers and steps to
 * it, and writes the whole task list back through the same action the workflow builder
 * uses. Two cheer triggers at different thresholds are two condition tasks in one
 * workflow, which is what makes them shareable and keeps the builder's view honest.
 *
 * Edits collect in the event's draft (lib/event-drafts.ts) until Save, including the
 * ones the alert editor hands back, so the page's Save and Discard cover all of them.
 */
export function EventWorkflowEditor({
  triggerPreset,
  actionPresets,
  workflows,
  breadcrumb,
  headingLevel,
  onTest,
  scope,
}: EventWorkflowEditorProps) {
  const event = triggerPreset.event ?? "";
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const { toast } = useToast();
  const createFromDefinition = useAction(api.workflowActions.createFromDefinition);
  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);
  const setEnabled = useAction(api.workflowActions.setEnabled);

  const [expandedTriggerId, setExpandedTriggerId] = useState<string | null>(null);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [openField, setOpenField] = useState<OpenField | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadedOptions, setLoadedOptions] = useState<ReadonlyMap<string, LoadedFieldOptions>>(new Map());

  // A commands field is folded into the event name rather than held as a condition,
  // so it has no place in the sentence.
  const conditionFields = useMemo(
    () => (triggerPreset.config?.fields ?? []).filter((field) => !isCommandsSource(field)),
    [triggerPreset]
  );
  const dynamicFields = useMemo(() => conditionFields.filter(isInternalSource), [conditionFields]);

  const { draft, others, unprojectable } = useEventWorkflowDraft(triggerPreset, conditionFields, workflows);

  const state = draft?.value ?? null;
  const isDirty = isDraftDirty(draft);

  const optionLabels = useMemo<OptionLabels>(() => {
    const labels = new Map(
      Array.from(loadedOptions.entries()).map(([fieldId, entry]) => [
        fieldId,
        new Map(entry.options.map((option) => [option.value, option.label])),
      ])
    );
    if (scope) {
      labels.set(scope.fieldId, new Map([[scope.value, scope.label]]));
    }
    return labels;
  }, [loadedOptions, scope]);

  const editableFields = useMemo(
    () => (scope ? conditionFields.filter((field) => field.id !== scope.fieldId) : conditionFields),
    [conditionFields, scope]
  );
  const visibleTriggers = (current: EventEditorState): ProjectedTrigger[] =>
    scope
      ? current.triggers.filter((trigger) => current.conditionValues[trigger.id]?.[scope.fieldId] === scope.value)
      : current.triggers;

  const handleOptionsLoaded = useCallback((fieldId: string, entry: LoadedFieldOptions) => {
    setLoadedOptions((previous) => new Map(previous).set(fieldId, entry));
  }, []);

  const resolveActionPreset = useCallback(
    (action: ProjectedAction): ActionPreset | undefined =>
      actionPresets.find((preset) =>
        action.functionCall ? preset.functionCall === action.functionCall : preset.handlerType === action.handlerType
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

  const usedIds = (current: EventEditorState): string[] => [
    ...current.triggers.map((t) => t.id),
    ...current.triggers.flatMap((t) => t.actions.map((a) => a.id)),
    ...current.shared.map((s) => s.id),
  ];

  const addTrigger = () => {
    if (!state) {
      return;
    }
    const id = nextTaskId("rule", usedIds(state));
    const values = {
      ...getDefaultConfigValues(conditionFields),
      ...(scope ? { [scope.fieldId]: scope.value } : {}),
    };
    mutate((current) => ({
      ...current,
      triggers: [...current.triggers, { id, enabled: true, conditions: [], actions: [] }],
      conditionValues: { ...current.conditionValues, [id]: values },
    }));
    setExpandedTriggerId(id);
    // A new trigger opens on the first value it still needs, so it never sits unfinished.
    const firstMissing = incompleteConditionFields(conditionFields, values)[0];
    setOpenField(firstMissing ? { triggerId: id, fieldId: firstMissing.id } : null);
  };

  const addAction = (triggerId: string, preset: ActionPreset) => {
    if (!state) {
      return;
    }
    const id = nextTaskId("act", usedIds(state));
    mutateTrigger(triggerId, (trigger) => ({
      ...trigger,
      actions: [
        ...trigger.actions,
        {
          id,
          handlerType: preset.handlerType ?? "function",
          functionCall: preset.functionCall,
          parameters: getDefaultConfigValues(preset.config?.fields ?? []),
          concurrentWithPrevious: false,
        },
      ],
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
    for (const trigger of state.triggers) {
      if (trigger.id === UNCONDITIONAL_TRIGGER_ID) {
        continue;
      }
      const incomplete = incompleteConditionFields(conditionFields, state.conditionValues[trigger.id] ?? {});
      if (incomplete.length > 0) {
        setOpenField({ triggerId: trigger.id, fieldId: incomplete[0].id });
        toast({
          title: "A trigger isn't finished",
          description: `Choose ${incomplete.map((field) => field.label.toLowerCase()).join(", ")}, or pick Any.`,
          variant: "destructive",
        });
        return;
      }
    }
    setIsSaving(true);
    try {
      const triggers = state.triggers.map((trigger) => ({
        ...trigger,
        conditions:
          trigger.id === UNCONDITIONAL_TRIGGER_ID
            ? []
            : fieldValuesToConditions(conditionFields, state.conditionValues[trigger.id] ?? {}),
      }));

      const definition = buildWorkflowDefinition({
        event,
        name: state.name,
        triggers,
        shared: state.shared,
        engineWorkflowId: state.engineWorkflowId,
      });

      if (state.engineWorkflowId) {
        await updateFromDefinition({
          instanceId: instance._id as Id<"instances">,
          engineWorkflowId: state.engineWorkflowId,
          definition: escapeDollarKeys(definition) as never,
        });
      } else {
        const created = await createFromDefinition({
          instanceId: instance._id as Id<"instances">,
          definition: escapeDollarKeys(definition) as never,
        });
        try {
          await setEnabled({
            instanceId: instance._id as Id<"instances">,
            engineWorkflowId: created.engineWorkflowId,
            isEnabled: true,
          });
        } catch {
          toast({
            title: "Saved, but not enabled",
            description: "Enable the workflow from the Workflows screen.",
            variant: "destructive",
          });
        }
      }
      const saved = getDraft(event);
      if (saved) {
        setDraft(event, { ...saved, baseline: JSON.stringify(saved.value) });
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

  const Heading = headingLevel;
  const ListHeading = headingLevel === "h1" ? "h2" : "h3";
  const shown = state ? visibleTriggers(state) : [];
  const count = shown.length;

  return (
    <section
      id={alertSectionAnchor(triggerPreset)}
      className="flex scroll-mt-6 flex-col gap-9"
      data-testid={`event-editor-${event}`}
    >
      {dynamicFields.map((field) => (
        <FieldOptionsLoader key={field.id} field={field} onLoaded={handleOptionsLoaded} />
      ))}

      <header className="flex items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-2.5">
          {breadcrumb.length > 0 && (
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-muted-foreground">
              {breadcrumb.map((crumb, index) => (
                <span key={crumb} className="flex items-center gap-2">
                  {index > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                  {crumb}
                </span>
              ))}
            </nav>
          )}
          <Heading
            className={cn(
              "font-semibold leading-tight tracking-[-0.02em]",
              headingLevel === "h1" ? "text-[28px] sm:text-4xl" : "text-2xl"
            )}
          >
            {triggerPreset.name}
          </Heading>
          {triggerPreset.description && <p className="text-sm text-muted-foreground">{triggerPreset.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onTest && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-muted-foreground hover:text-foreground sm:h-10 sm:w-10"
                  onClick={onTest}
                  aria-label={`Test ${triggerPreset.name}`}
                  data-testid={`test-event-${event}`}
                >
                  <Zap className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fire a test event</TooltipContent>
            </Tooltip>
          )}
          <Button
            onClick={addTrigger}
            disabled={!state}
            className="h-11 w-11 px-0 sm:h-10 sm:w-auto sm:pl-3.5 sm:pr-4"
            aria-label="New trigger"
            data-testid={`add-trigger-${event}`}
          >
            <Plus className="h-4 w-4 sm:mr-2" aria-hidden="true" />
            <span className="hidden sm:inline">New trigger</span>
          </Button>
        </div>
      </header>

      {!state ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 px-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <ListHeading className="text-[13px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              {count === 1 ? "1 trigger" : `${count} triggers`}
            </ListHeading>
            <code title={`Event: ${event}`} className="min-w-0 truncate font-mono text-xs text-muted-foreground/80">
              {event}
            </code>
          </div>

          {unprojectable && (
            <p className="px-1 text-xs text-muted-foreground">
              A workflow on this event uses steps this screen can't show. It is left untouched — edit it in the workflow
              builder.
            </p>
          )}
          {others.length > 0 && (
            <p className="px-1 text-xs text-muted-foreground">
              {others.length} other workflow{others.length === 1 ? "" : "s"} also fire on this event.
            </p>
          )}

          {count === 0 && scope ? (
            <p className="rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
              Nothing happens yet. Add a trigger to decide what does.
            </p>
          ) : count === 0 ? (
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
                  conditionFields={editableFields}
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
