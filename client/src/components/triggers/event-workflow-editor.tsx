import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { TriggerCard } from "@/components/triggers/trigger-card";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import {
  buildWorkflowDefinition,
  nextTaskId,
  type ProjectedAction,
  type ProjectedSharedAction,
  type ProjectedTrigger,
  projectWorkflow,
  UNCONDITIONAL_TRIGGER_ID,
} from "@/lib/trigger-projection";
import {
  type ActionPreset,
  formatConfigValue,
  getDefaultConfigValues,
  type TriggerConfigValues,
  type TriggerPreset,
} from "@/lib/workflow-presets";
import { conditionsToFieldValues, fieldValuesToConditions } from "@/lib/workflow-presets-json";

interface EventWorkflowEditorProps {
  triggerPreset: TriggerPreset;
  actionPresets: ActionPreset[];
  /** Every workflow on this instance; the ones for this event are found here. */
  workflows: Doc<"workflows">[];
}

interface EditorState {
  engineWorkflowId?: string;
  name: string;
  triggers: ProjectedTrigger[];
  shared: ProjectedSharedAction[];
  /** Condition values per trigger id, decoded once so editing stays in field space. */
  conditionValues: Record<string, TriggerConfigValues>;
}

/**
 * Edits every configured trigger for one event as a single workflow.
 *
 * The workflow is the record: this reads one, lets the user add triggers and actions to
 * it, and writes the whole task list back through the same action the workflow builder
 * uses. Two cheer triggers at different thresholds are two condition tasks in one
 * workflow, which is what makes them shareable and keeps the builder's view honest.
 */
export function EventWorkflowEditor({ triggerPreset, actionPresets, workflows }: EventWorkflowEditorProps) {
  const event = triggerPreset.event ?? "";
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const { toast } = useToast();
  const createFromDefinition = useAction(api.workflowActions.createFromDefinition);
  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);
  const setEnabled = useAction(api.workflowActions.setEnabled);

  const matching = useMemo(
    () =>
      workflows.filter((row) => {
        const projected = projectWorkflow(row);
        return projected.ok ? projected.projection.event === event : rowEvent(row) === event;
      }),
    [workflows, event]
  );

  // The first projectable workflow is the one this screen edits. Others on the same
  // event are left alone and pointed at the builder rather than silently merged.
  const primary = matching.find((row) => projectWorkflow(row).ok);
  const primaryProjection = primary ? projectWorkflow(primary) : undefined;
  const others = matching.filter((row) => row !== primary);
  const unprojectable = matching.find((row) => !projectWorkflow(row).ok);

  // Value and the snapshot it was loaded from, together: unsaved edits are exactly
  // "value differs from baseline", and both move as one so the sync effect below
  // cannot race itself.
  const [editor, setEditor] = useState<{ value: EditorState; baseline: string } | null>(null);
  const [expandedTriggerId, setExpandedTriggerId] = useState<string | null>(null);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const conditionFields = useMemo(() => triggerPreset.config?.fields ?? [], [triggerPreset]);

  const loaded = useMemo<EditorState>(() => {
    if (primaryProjection?.ok === true) {
      const { projection } = primaryProjection;
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
  }, [primaryProjection, conditionFields, triggerPreset.name]);

  const loadedSnapshot = useMemo(() => JSON.stringify(loaded), [loaded]);

  // Adopt the engine's copy whenever it changes, so an edit made in the workflow
  // builder shows up here — unless there are unsaved edits, which win.
  useEffect(() => {
    setEditor((current) => {
      if (current && JSON.stringify(current.value) !== current.baseline) {
        return current;
      }
      return { value: loaded, baseline: loadedSnapshot };
    });
  }, [loaded, loadedSnapshot]);

  const state = editor?.value ?? null;
  const isDirty = editor !== null && JSON.stringify(editor.value) !== editor.baseline;

  const resolveActionPreset = useCallback(
    (action: ProjectedAction): ActionPreset | undefined =>
      actionPresets.find((preset) =>
        action.functionCall ? preset.functionCall === action.functionCall : preset.handlerType === action.handlerType
      ),
    [actionPresets]
  );

  const usedIds = useMemo(() => {
    if (!state) {
      return [] as string[];
    }
    return [
      ...state.triggers.map((t) => t.id),
      ...state.triggers.flatMap((t) => t.actions.map((a) => a.id)),
      ...state.shared.map((s) => s.id),
    ];
  }, [state]);

  function mutate(updater: (current: EditorState) => EditorState) {
    setEditor((current) => (current ? { ...current, value: updater(current.value) } : current));
  }

  const addTrigger = () => {
    if (!state) {
      return;
    }
    const id = nextTaskId("rule", usedIds);
    mutate((current) => ({
      ...current,
      triggers: [...current.triggers, { id, conditions: [], actions: [] }],
      conditionValues: { ...current.conditionValues, [id]: getDefaultConfigValues(conditionFields) },
    }));
    setExpandedTriggerId(id);
  };

  const addAction = (triggerId: string, preset: ActionPreset) => {
    const id = nextTaskId("act", usedIds);
    mutate((current) => ({
      ...current,
      triggers: current.triggers.map((trigger) =>
        trigger.id === triggerId
          ? {
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
            }
          : trigger
      ),
    }));
    setExpandedActionId(id);
  };

  async function handleSave() {
    if (!instance || !state) {
      return;
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
        toast({ title: "Saved" });
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
          toast({ title: "Saved" });
        } catch {
          toast({
            title: "Saved, but not enabled",
            description: "Enable the workflow from the Workflows screen.",
            variant: "destructive",
          });
        }
      }
      setEditor((current) => (current ? { ...current, baseline: JSON.stringify(current.value) } : current));
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

  if (!state) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  return (
    <section className="space-y-3" data-testid={`event-editor-${event}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{triggerPreset.name}</h2>
          <p className="text-xs text-muted-foreground truncate">{triggerPreset.description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={addTrigger} data-testid={`add-trigger-${event}`}>
          <Plus className="h-4 w-4 mr-2" />
          Add trigger
        </Button>
      </div>

      {unprojectable && (
        <p className="text-xs text-muted-foreground">
          A workflow on this event uses steps this screen can't show. It is left untouched — edit it in the workflow
          builder.
        </p>
      )}

      {state.triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Nothing configured yet. Add a trigger to decide when this fires and what it does.
        </p>
      ) : (
        <div className="space-y-2">
          {state.triggers.map((trigger) => (
            <TriggerCard
              key={trigger.id}
              trigger={trigger}
              triggerPreset={triggerPreset}
              actionPresets={actionPresets}
              conditionValues={state.conditionValues[trigger.id] ?? {}}
              isExpanded={expandedTriggerId === trigger.id}
              expandedActionId={expandedActionId}
              summary={summarizeTrigger(
                trigger,
                state.conditionValues[trigger.id] ?? {},
                conditionFields,
                triggerPreset
              )}
              resolveActionPreset={resolveActionPreset}
              onToggleExpanded={() => setExpandedTriggerId(expandedTriggerId === trigger.id ? null : trigger.id)}
              onExpandAction={setExpandedActionId}
              onChangeConditions={(values) =>
                mutate((current) => ({
                  ...current,
                  conditionValues: { ...current.conditionValues, [trigger.id]: values },
                }))
              }
              onChangeActionParameters={(actionId, parameters) =>
                mutate((current) => ({
                  ...current,
                  triggers: current.triggers.map((t) =>
                    t.id === trigger.id
                      ? { ...t, actions: t.actions.map((a) => (a.id === actionId ? { ...a, parameters } : a)) }
                      : t
                  ),
                }))
              }
              onToggleActionConcurrent={(actionId) =>
                mutate((current) => ({
                  ...current,
                  triggers: current.triggers.map((t) =>
                    t.id === trigger.id
                      ? {
                          ...t,
                          actions: t.actions.map((a) =>
                            a.id === actionId ? { ...a, concurrentWithPrevious: !a.concurrentWithPrevious } : a
                          ),
                        }
                      : t
                  ),
                }))
              }
              onRemoveAction={(actionId) =>
                mutate((current) => ({
                  ...current,
                  triggers: current.triggers.map((t) =>
                    t.id === trigger.id ? { ...t, actions: t.actions.filter((a) => a.id !== actionId) } : t
                  ),
                  // A shared action loses an owner with it; one with none left goes too.
                  shared: current.shared
                    .map((s) => ({ ...s, triggerIds: s.triggerIds.filter((id) => id !== actionId) }))
                    .filter((s) => s.triggerIds.length > 0),
                }))
              }
              onAddAction={(preset) => addAction(trigger.id, preset)}
              onRemove={() =>
                mutate((current) => ({
                  ...current,
                  triggers: current.triggers.filter((t) => t.id !== trigger.id),
                  shared: current.shared
                    .map((s) => ({ ...s, triggerIds: s.triggerIds.filter((id) => id !== trigger.id) }))
                    .filter((s) => s.triggerIds.length > 0),
                }))
              }
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button onClick={handleSave} disabled={!isDirty || isSaving} data-testid={`save-${event}`}>
          {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isDirty ? "Save changes" : "Saved"}
        </Button>

        {state.engineWorkflowId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/stream/workflows/${state.engineWorkflowId}`)}
            className="text-muted-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5 mr-2" />
            Open workflow
          </Button>
        )}

        {others.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {others.length} other workflow{others.length === 1 ? "" : "s"} also fire on this event
          </span>
        )}
      </div>
    </section>
  );
}

function rowEvent(row: Doc<"workflows">): string | undefined {
  const definition = row.definition as { trigger?: { event?: string } } | undefined;
  return definition?.trigger?.event;
}

/** "Bits ≥ 1000" — what the collapsed card shows so a long list stays scannable. */
function summarizeTrigger(
  trigger: ProjectedTrigger,
  values: TriggerConfigValues,
  fields: TriggerPreset["config"] extends undefined ? never : NonNullable<TriggerPreset["config"]>["fields"],
  preset: TriggerPreset
): string {
  if (trigger.id === UNCONDITIONAL_TRIGGER_ID) {
    return `Every ${preset.name.toLowerCase()}`;
  }
  const parts: string[] = [];
  for (const field of fields) {
    const value = values[field.id];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const option = field.options?.find((o) => o.value === String(value));
    parts.push(`${field.label}: ${option ? option.label : formatConfigValue(value, field.unit)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : `Every ${preset.name.toLowerCase()}`;
}
