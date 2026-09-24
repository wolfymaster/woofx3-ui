import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { Loader2, Plus } from "lucide-react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { ResourceInstanceDoc } from "@/components/resources/resource-kind-page";
import { TriggerPicker } from "@/components/test-events/trigger-picker";
import { EventWorkflowEditor } from "@/components/triggers/event-workflow-editor";
import { SaveState } from "@/components/triggers/save-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import type { AlertMenuSection } from "@/lib/alert-groups";
import { getDraft, isDraftDirty, setDraft, subscribeToDrafts } from "@/lib/event-drafts";
import { type ActionScope, conditionFieldsOf, eventEditorStateFor, withNewTrigger } from "@/lib/event-workflow-state";
import { eventsChangingResource, resourceActions } from "@/lib/resource-actions";
import { firstIncompleteTrigger, saveEventDraft } from "@/lib/save-event-draft";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * What changes this instance: every trigger, on any event, that runs one of the kind's
 * actions against it — a chat command that adds to a counter, a raid that adds time to a
 * timer.
 *
 * The mirror of ResourceTriggerEditors, which shows what this instance's *own* events
 * set off. Both edit the same workflows the Alerts screen and the workflow builder do:
 * one per event, a condition task per trigger. This screen is one list across many
 * events, so it borrows each event's editor without its heading and Save bar (`bare`)
 * and saves them together — each event is still its own workflow, written in turn.
 */
export function ResourceActionEditors({ kind, instance }: { kind: string; instance: ResourceInstanceDoc }) {
  const { instance: engineInstance } = useInstance();
  const { toast } = useToast();
  const { triggerPresets, actionPresets, loading } = useWorkflowCatalog();
  const workflows = useQuery(api.workflows.list, engineInstance ? { instanceId: engineInstance._id } : "skip");
  const createFromDefinition = useAction(api.workflowActions.createFromDefinition);
  const updateFromDefinition = useAction(api.workflowActions.updateFromDefinition);
  const setEnabled = useAction(api.workflowActions.setEnabled);

  const [addedEvents, setAddedEvents] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const actions = useMemo(() => resourceActions(actionPresets, kind), [actionPresets, kind]);
  const actionScope = useMemo<ActionScope>(
    () => ({ actions, value: instance.canonicalId }),
    [actions, instance.canonicalId]
  );

  // An event is listed once it has a trigger changing this instance, or once this
  // session added one — a trigger that is not saved yet is in the draft, not the engine.
  const events = useMemo(() => {
    const stored = eventsChangingResource((workflows as Doc<"workflows">[]) ?? [], actions, instance.canonicalId);
    return Array.from(new Set([...stored, ...addedEvents])).sort();
  }, [workflows, actions, instance.canonicalId, addedEvents]);

  const presetFor = useCallback(
    (event: string) => triggerPresets.find((preset) => preset.event === event),
    [triggerPresets]
  );

  const isDirty = useSyncExternalStore(
    subscribeToDrafts,
    useCallback(() => events.some((event) => isDraftDirty(getDraft(event))), [events])
  );

  const addTrigger = (triggerPreset: TriggerPreset, actionPresetId: string) => {
    const event = triggerPreset.event;
    const seed = actions.find((candidate) => candidate.preset.id === actionPresetId)?.preset;
    if (!event || !seed || workflows === undefined) {
      return;
    }
    const conditionFields = conditionFieldsOf(triggerPreset);
    const open = getDraft(event);
    // A draft already open for this event carries edits the outbound section or the
    // Alerts screen may have made; the new trigger joins them rather than replacing them.
    const base = open?.value ?? eventEditorStateFor(workflows as Doc<"workflows">[], triggerPreset, conditionFields);
    const baseline = open?.baseline ?? JSON.stringify(base);
    const { state } = withNewTrigger(base, conditionFields, { actionScope, seed });
    setDraft(event, { value: state, baseline });
    setAddedEvents((previous) => (previous.includes(event) ? previous : [...previous, event]));
  };

  const handleDiscard = () => {
    for (const event of events) {
      const draft = getDraft(event);
      if (draft) {
        setDraft(event, { value: JSON.parse(draft.baseline), baseline: draft.baseline });
      }
    }
    setAddedEvents([]);
  };

  async function handleSave() {
    if (!engineInstance) {
      return;
    }
    setIsSaving(true);
    try {
      // One event at a time: each is its own workflow and its own engine round trip, so
      // a failure names the event it stopped on and leaves the rest as they were.
      for (const event of events) {
        const triggerPreset = presetFor(event);
        const draft = getDraft(event);
        if (!triggerPreset || !draft || !isDraftDirty(draft)) {
          continue;
        }
        const conditionFields = conditionFieldsOf(triggerPreset);
        const incomplete = firstIncompleteTrigger(draft.value, conditionFields);
        if (incomplete) {
          toast({
            title: `${triggerPreset.name} isn't finished`,
            description: `Choose ${incomplete.fields.map((field) => field.label.toLowerCase()).join(", ")}, or pick Any.`,
            variant: "destructive",
          });
          return;
        }
        const { enabled } = await saveEventDraft(event, draft.value, conditionFields, {
          instanceId: engineInstance._id as Id<"instances">,
          createFromDefinition,
          updateFromDefinition,
          setEnabled,
        });
        if (!enabled) {
          toast({
            title: "Saved, but not enabled",
            description: `Enable the ${triggerPreset.name} workflow from the Workflows screen.`,
            variant: "destructive",
          });
        }
      }
      setAddedEvents([]);
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

  if (loading || workflows === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (actions.length === 0) {
    return null;
  }

  const label = instance.displayName || instance.resourceInstanceId;
  return (
    <section className="flex flex-col gap-4 pt-4" data-testid={`resource-actions-${kind}`}>
      <div className="flex flex-col gap-2.5">
        <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em]">What changes {label}</h2>
        <p className="text-sm text-muted-foreground">
          Every trigger that runs one of these actions on it. The {kind} is already chosen, so a step here only asks for
          the rest.
        </p>
      </div>

      {events.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
          Nothing changes it yet. Add a trigger to decide what does.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((event) => {
            const triggerPreset = presetFor(event);
            if (!triggerPreset) {
              return null;
            }
            return (
              <EventWorkflowEditor
                key={event}
                bare
                triggerPreset={triggerPreset}
                actionPresets={actionPresets}
                workflows={workflows as Doc<"workflows">[]}
                breadcrumb={[]}
                headingLevel="h2"
                actionScope={actionScope}
              />
            );
          })}
        </div>
      )}

      <AddTriggerButton triggerPresets={triggerPresets} actions={actions} onAdd={addTrigger} />
      <SaveState isDirty={isDirty} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
    </section>
  );
}

/**
 * Choosing what sets a change off, and which change it is.
 *
 * Both are asked for here rather than on the trigger afterwards, because a trigger with
 * no step yet would not be one this section shows — it lists the triggers that change
 * the instance, and until it has the step it does not.
 */
function AddTriggerButton({
  triggerPresets,
  actions,
  onAdd,
}: {
  triggerPresets: TriggerPreset[];
  actions: ReturnType<typeof resourceActions>;
  onAdd: (triggerPreset: TriggerPreset, actionPresetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [triggerId, setTriggerId] = useState<string | null>(null);
  // Not defaulted: the actions are ordered by name, so the first is no more likely than
  // any other to be the one meant (a counter's is Decrement, not Increment).
  const [actionId, setActionId] = useState<string>("");

  const sections = useMemo(() => triggerMenuSections(triggerPresets), [triggerPresets]);
  const chosen = triggerPresets.find((preset) => preset.id === triggerId);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTriggerId(null);
          setActionId("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-11 self-start sm:h-10" data-testid="button-add-resource-trigger">
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add trigger
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] space-y-4" align="start">
        <div className="space-y-2">
          <Label htmlFor="resource-trigger">When this happens</Label>
          <TriggerPicker
            id="resource-trigger"
            testId="resource-trigger"
            placeholder="Choose a trigger…"
            sections={sections}
            selectedId={triggerId}
            onSelect={setTriggerId}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="resource-trigger-action">Do this</Label>
          <Select value={actionId} onValueChange={setActionId}>
            <SelectTrigger id="resource-trigger-action" data-testid="select-resource-trigger-action">
              <SelectValue placeholder="Choose an action…" />
            </SelectTrigger>
            <SelectContent>
              {actions.map(({ preset }) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="w-full"
          disabled={!chosen || !actionId}
          onClick={() => {
            if (!chosen) {
              return;
            }
            onAdd(chosen, actionId);
            setOpen(false);
          }}
          data-testid="button-confirm-resource-trigger"
        >
          Add
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Every trigger that can start a workflow, grouped for the picker.
 *
 * By category rather than by the Alerts menu's taxonomy, because that menu only places
 * the `alert.*` triggers and this list is the whole catalog — a chat command changes a
 * counter as readily as a cheer does.
 */
function triggerMenuSections(triggerPresets: TriggerPreset[]): AlertMenuSection[] {
  const byCategory = new Map<string, TriggerPreset[]>();
  for (const preset of triggerPresets) {
    if (!preset.event) {
      continue;
    }
    const group = byCategory.get(preset.category);
    if (group) {
      group.push(preset);
    } else {
      byCategory.set(preset.category, [preset]);
    }
  }
  return Array.from(byCategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, presets]) => ({
      id: category,
      label: category,
      presets: [...presets].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}
