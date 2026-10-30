import { bareKind } from "@shared/resource-kinds";
import { Loader2, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  EventTriggerList,
  type NewTriggerRequest,
  type TriggerActionScope,
} from "@/components/alerts/event-trigger-list";
import { TriggerPicker } from "@/components/test-events/trigger-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkflows } from "@/engine/hooks/use-workflows";
import type { ModuleResourceInstance } from "@/engine/types";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import type { AlertMenuSection } from "@/lib/alert-groups";
import { eventsChangingResource, resourceActions } from "@/lib/resource-actions";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * What changes this instance: every trigger, on any event, that runs one of the kind's
 * actions against it — a chat command that adds to a counter, a raid that adds time to a
 * timer.
 *
 * The mirror of ResourceTriggerEditors, which shows what this instance's *own* events
 * set off. Both edit the same workflows the Alerts screen and the workflow builder do:
 * one per trigger. This screen is one list across many events, so it borrows each
 * event's list without its heading (`bare`).
 */
export function ResourceActionEditors({ kind, instance }: { kind: string; instance: ModuleResourceInstance }) {
  const { triggerPresets, actionPresets, loading } = useWorkflowCatalog();
  const workflows = useWorkflows();

  // The trigger being added, on its event's list, until it is saved or dropped.
  const [adding, setAdding] = useState<{ event: string; request: NewTriggerRequest } | null>(null);

  const actions = useMemo(() => resourceActions(actionPresets, kind), [actionPresets, kind]);
  const actionScope = useMemo<TriggerActionScope>(
    () => ({ actions, value: instance.canonicalId }),
    [actions, instance.canonicalId]
  );

  // An event is listed once it has a trigger changing this instance, or while one is
  // being added to it — a trigger with no saved step exists only in its editor.
  const events = useMemo(() => {
    const stored = eventsChangingResource(workflows ?? [], actions, instance.canonicalId);
    return Array.from(new Set([...stored, ...(adding ? [adding.event] : [])])).sort();
  }, [workflows, actions, instance.canonicalId, adding]);

  const presetFor = useCallback(
    (event: string) => triggerPresets.find((preset) => preset.event === event),
    [triggerPresets]
  );

  const addTrigger = (triggerPreset: TriggerPreset, actionPresetId: string) => {
    const seed = actions.find((candidate) => candidate.preset.id === actionPresetId)?.preset;
    if (!triggerPreset.event || !seed) {
      return;
    }
    setAdding({ event: triggerPreset.event, request: { key: Date.now(), seed } });
  };

  if (loading || workflows === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (actions.length === 0) {
    return null;
  }

  const label = instance.displayName || instance.resourceInstanceId;
  return (
    <section className="flex flex-col gap-4 pt-4" data-testid={`resource-actions-${bareKind(kind)}`}>
      <div className="flex flex-col gap-2.5">
        <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em]">What changes {label}</h2>
        <p className="text-sm text-muted-foreground">
          Every trigger that runs one of these actions on it. A step added here starts aimed at this {bareKind(kind)}.
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
              <EventTriggerList
                key={event}
                bare
                triggerPreset={triggerPreset}
                workflows={workflows}
                breadcrumb={[]}
                headingLevel="h2"
                actionScope={actionScope}
                startNew={adding?.event === event ? adding.request : undefined}
              />
            );
          })}
        </div>
      )}

      <AddTriggerButton triggerPresets={triggerPresets} actions={actions} onAdd={addTrigger} />
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
