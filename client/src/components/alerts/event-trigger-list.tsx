import type { Id } from "@convex/_generated/dataModel";
import { ChevronRight, ExternalLink, Plus, Zap } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { type SavedTrigger, TriggerEditor } from "@/components/alerts/trigger-editor";
import type { LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { EventWorkflowEditor } from "@/components/triggers/event-workflow-editor";
import { FieldOptionsLoader } from "@/components/triggers/field-options-loader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotRunningBadge } from "@/components/workflows/not-running-badge";
import { WorkflowNotEditable } from "@/components/workflows/workflow-not-editable";
import { toInstanceId } from "@/engine/convex/ids";
import { useSetWorkflowEnabledRequest } from "@/engine/hooks/use-workflows";
import type { Workflow } from "@/engine/types";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { useNotRunningWorkflows } from "@/hooks/use-workflow-health";
import { alertSectionAnchor } from "@/lib/alert-groups";
import {
  type EventTrigger,
  eventTriggers,
  isPinnedTo,
  newTriggerTree,
  nextTriggerOrder,
  type TriggerPin,
  triggerAimsAt,
  triggerFieldValues,
} from "@/lib/alert-triggers";
import { type OptionLabels, type SentencePart, sentenceParts, sentenceText } from "@/lib/condition-sentence";
import { conditionFieldsOf } from "@/lib/event-workflow-state";
import { isInternalSource } from "@/lib/parse-config-fields";
import type { ResourceAction } from "@/lib/resource-actions";
import { stepSummary } from "@/lib/step-summary";
import { projectWorkflow } from "@/lib/trigger-projection";
import { cn } from "@/lib/utils";
import { resolveCatalogAction } from "@/lib/workflow-node-label";
import type { ActionPreset, TriggerPreset } from "@/lib/workflow-presets";
import { definitionToTree, type WorkflowTree } from "@/lib/workflow-tree";

/** The triggers running one of a resource's actions against one instance of it. */
export interface TriggerActionScope {
  actions: ResourceAction[];
  /** The instance's canonical id. */
  value: string;
}

/** A request to start a new trigger with a step already chosen; a new `key` starts another. */
export interface NewTriggerRequest {
  key: number;
  seed: ActionPreset;
}

interface EventTriggerListProps {
  triggerPreset: TriggerPreset;
  /** Every workflow on this instance; the ones for this event are found here. */
  workflows: Workflow[];
  /** Where this event sits in the Alerts menu, above its own title. */
  breadcrumb: string[];
  /** h1 when the event is the page; h2 when it shares the page with others. */
  headingLevel: "h1" | "h2";
  /** Opens the test sheet on this event; no lightning icon when omitted. */
  onTest?: () => void;
  /** Shows only the triggers pinned to one value of one condition field, and pins new ones to it. */
  pin?: TriggerPin & { label: string };
  /** Shows only the triggers running one of a resource's actions against it. */
  actionScope?: TriggerActionScope;
  /** Renders the cards alone, without heading or count, for a screen listing several events as one list. */
  bare?: boolean;
  startNew?: NewTriggerRequest;
  /** What the page shows about the event between its heading and its triggers. */
  children?: ReactNode;
}

/** The card id of the trigger being written, before it has a workflow. */
const NEW_TRIGGER = "new";

/**
 * Every trigger for one event, as cards in the order they run.
 *
 * Each trigger is a workflow of its own (lib/alert-triggers.ts). A card reads as the
 * trigger's sentence and its steps; opening it shows the step editor, with the sentence as
 * the "When" card. Every trigger whose sentence holds runs, top to bottom.
 *
 * A workflow the step editor can't read is still listed and still opens: one holding
 * several triggers the way this page once stored them opens in the triggers editor those
 * were written in, and anything else says why it can't be edited here.
 */
export function EventTriggerList({
  triggerPreset,
  workflows,
  breadcrumb,
  headingLevel,
  onTest,
  pin,
  actionScope,
  bare = false,
  startNew,
  children,
}: EventTriggerListProps) {
  const event = triggerPreset.event ?? "";
  const { instance } = useInstance();
  const { actionPresets } = useWorkflowCatalog();
  const conditionFields = useMemo(() => conditionFieldsOf(triggerPreset), [triggerPreset]);
  const dynamicFields = useMemo(() => conditionFields.filter(isInternalSource), [conditionFields]);
  const [loadedOptions, setLoadedOptions] = useState<ReadonlyMap<string, LoadedFieldOptions>>(new Map());
  const handleOptionsLoaded = useCallback((fieldId: string, entry: LoadedFieldOptions) => {
    setLoadedOptions((previous) => new Map(previous).set(fieldId, entry));
  }, []);
  const optionLabels = useMemo<OptionLabels>(() => {
    const labels = new Map(
      Array.from(loadedOptions.entries()).map(([fieldId, entry]) => [
        fieldId,
        new Map(entry.options.map((option) => [option.value, option.label])),
      ])
    );
    if (pin) {
      labels.set(pin.fieldId, new Map([[pin.value, pin.label]]));
    }
    return labels;
  }, [loadedOptions, pin]);

  const all = useMemo(() => eventTriggers(workflows, event), [workflows, event]);
  const shown = useMemo(
    () =>
      all.filter(
        (trigger) =>
          (!pin || isPinnedTo(trigger, conditionFields, pin)) &&
          (!actionScope || triggerAimsAt(trigger, actionScope.actions, actionScope.value))
      ),
    [all, pin, actionScope, conditionFields]
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowTree | null>(null);
  // A trigger created from the draft stays the draft's card until the list carries it.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const startDraft = useCallback(
    (seed?: ActionPreset) => {
      setDraft(
        newTriggerTree({
          triggerPreset,
          conditionFields,
          order: nextTriggerOrder(all),
          pin,
          seed,
          aim: seed && actionScope ? aimFor(seed, actionScope) : undefined,
        })
      );
      setCreatedId(null);
      setExpandedId(NEW_TRIGGER);
    },
    [triggerPreset, conditionFields, all, pin, actionScope]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: a request starts one draft, when its key changes
  useEffect(() => {
    if (startNew) {
      startDraft(startNew.seed);
    }
  }, [startNew?.key]);

  const draftArrived = createdId !== null && all.some((trigger) => trigger.row.engineWorkflowId === createdId);
  useEffect(() => {
    if (draftArrived && createdId) {
      setDraft(null);
      setExpandedId((current) => (current === NEW_TRIGGER ? createdId : current));
      setCreatedId(null);
    }
  }, [draftArrived, createdId]);

  const Heading = headingLevel;
  const ListHeading = headingLevel === "h1" ? "h2" : "h3";
  const count = shown.length;
  const sentenceFor = (conditions: EventTrigger["conditions"]) =>
    sentenceParts(
      triggerPreset.sentence,
      conditionFields,
      triggerFieldValues(conditions, conditionFields),
      optionLabels
    );

  return (
    <section
      id={bare ? undefined : alertSectionAnchor(triggerPreset)}
      className="flex scroll-mt-6 flex-col gap-9"
      data-testid={`event-editor-${event}`}
    >
      {dynamicFields.map((field) => (
        <FieldOptionsLoader key={field.id} field={field} onLoaded={handleOptionsLoaded} />
      ))}

      {!bare && (
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
              onClick={() => startDraft()}
              disabled={!instance}
              className="h-11 w-11 px-0 sm:h-10 sm:w-auto sm:pl-3.5 sm:pr-4"
              aria-label="New trigger"
              data-testid={`add-trigger-${event}`}
            >
              <Plus className="h-4 w-4 sm:mr-2" aria-hidden="true" />
              <span className="hidden sm:inline">New trigger</span>
            </Button>
          </div>
        </header>
      )}

      {children}

      <div className="flex flex-col gap-3">
        {!bare && (
          <div className="flex flex-col gap-1 px-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <ListHeading className="text-[13px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              {count === 1 ? "1 trigger" : `${count} triggers`}
            </ListHeading>
            <code title={`Event: ${event}`} className="min-w-0 truncate font-mono text-xs text-muted-foreground/80">
              {event}
            </code>
          </div>
        )}
        {!bare && count > 1 && (
          <p className="px-1 text-xs text-muted-foreground">
            Every trigger that matches runs, top to bottom, each after the one above it finishes or pauses.
          </p>
        )}

        {count === 0 && !draft ? (
          bare ? null : pin ? (
            <p className="rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
              Nothing happens yet. Add a trigger to decide what does.
            </p>
          ) : (
            <div className="flex flex-col items-center gap-3.5 rounded-2xl border border-dashed px-6 py-14 text-center">
              <p className="text-base font-medium">No triggers yet</p>
              <p className="max-w-[360px] text-sm text-muted-foreground">
                Set the conditions and decide what happens when this event fires.
              </p>
              <Button variant="outline" className="h-11 sm:h-10" onClick={() => startDraft()}>
                Create your first trigger
              </Button>
            </div>
          )
        ) : null}

        {instance &&
          shown.map((trigger) => (
            <TriggerCard
              key={trigger.row.engineWorkflowId}
              instanceId={instance._id as Id<"instances">}
              trigger={trigger}
              triggerPreset={triggerPreset}
              sentence={sentenceFor(trigger.conditions)}
              isExpanded={expandedId === trigger.row.engineWorkflowId}
              onToggle={() =>
                setExpandedId(expandedId === trigger.row.engineWorkflowId ? null : trigger.row.engineWorkflowId)
              }
              editor={(read) => (
                <TriggerEditor
                  instanceId={instance._id as Id<"instances">}
                  triggerPreset={triggerPreset}
                  conditionFields={conditionFields}
                  saved={
                    { engineWorkflowId: trigger.row.engineWorkflowId, definition: trigger.definition } as SavedTrigger
                  }
                  initialTree={read}
                  pin={pin}
                  loadedOptions={loadedOptions}
                  optionLabels={optionLabels}
                  onCreated={() => undefined}
                  onDeleted={() => setExpandedId(null)}
                />
              )}
              legacyEditor={
                <EventWorkflowEditor
                  triggerPreset={triggerPreset}
                  actionPresets={actionPresets}
                  workflows={[trigger.row]}
                />
              }
            />
          ))}

        {instance && draft && (
          <article
            className="rounded-2xl border border-foreground/20 bg-card p-4 sm:p-5"
            data-testid="trigger-card-new"
          >
            <TriggerEditor
              instanceId={instance._id as Id<"instances">}
              triggerPreset={triggerPreset}
              conditionFields={conditionFields}
              saved={undefined}
              initialTree={draft}
              pin={pin}
              loadedOptions={loadedOptions}
              optionLabels={optionLabels}
              onCreated={setCreatedId}
              onDeleted={() => {
                setDraft(null);
                setExpandedId(null);
              }}
            />
          </article>
        )}
      </div>
    </section>
  );
}

/** The parameter aiming `seed` at the scoped instance, when `seed` is one of the scope's actions. */
function aimFor(seed: ActionPreset, scope: TriggerActionScope): TriggerPin | undefined {
  const aimed = scope.actions.find((candidate) => candidate.preset.id === seed.id);
  return aimed ? { fieldId: aimed.fieldId, value: scope.value } : undefined;
}

interface TriggerCardProps {
  instanceId: Id<"instances">;
  trigger: EventTrigger;
  triggerPreset: TriggerPreset;
  sentence: SentencePart[];
  isExpanded: boolean;
  onToggle: () => void;
  /** The step editor for a workflow it can read. */
  editor: (tree: WorkflowTree) => ReactNode;
  /** The editor for several triggers stored in one workflow. */
  legacyEditor: ReactNode;
}

/** One trigger: its sentence and steps on one card, opening onto its editor. */
function TriggerCard({
  instanceId,
  trigger,
  triggerPreset,
  sentence,
  isExpanded,
  onToggle,
  editor,
  legacyEditor,
}: TriggerCardProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { catalogActions } = useWorkflowCatalog();
  const { byId: notRunning } = useNotRunningWorkflows();
  const setEnabled = useSetWorkflowEnabledRequest();
  const [isSwitching, setIsSwitching] = useState(false);
  const { row } = trigger;

  const read = useMemo(() => definitionToTree(trigger.definition), [trigger.definition]);
  const stored = useMemo(() => (read.editable ? null : projectWorkflow(row)), [read, row]);
  const storedTogether = stored?.ok === true ? stored.projection.triggers.length : 0;

  const title =
    storedTogether > 1
      ? `${storedTogether} ${triggerPreset.name.toLowerCase()} triggers saved together`
      : sentence.length === 0
        ? triggerPreset.name
        : sentenceText(sentence);
  const summary = read.editable
    ? read.tree.steps.length === 0
      ? "No steps yet"
      : read.tree.steps
          .map(
            (step) =>
              stepSummary(step, {
                action: step.type === "action" ? resolveCatalogAction(step, catalogActions) : undefined,
              }).title
          )
          .join("  →  ")
    : "Opens in the editor it was written in";
  const health = row.isEnabled ? notRunning.get(row.engineWorkflowId) : undefined;

  async function toggleEnabled() {
    setIsSwitching(true);
    try {
      await setEnabled(toInstanceId(instanceId), row.engineWorkflowId, !row.isEnabled);
    } catch (err) {
      toast({
        title: row.isEnabled ? "Couldn't pause the trigger" : "Couldn't switch the trigger on",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsSwitching(false);
    }
  }

  return (
    <article
      className={cn("rounded-2xl border bg-card", isExpanded && "border-foreground/20")}
      data-testid={`trigger-card-${row.engineWorkflowId}`}
    >
      <div className="relative flex items-center gap-2 py-2.5 pl-2 pr-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={`${title}. ${isExpanded ? "Close" : "Open"}`}
          className="flex h-[52px] w-9 shrink-0 items-center justify-center rounded-[10px] after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:bg-accent"
          data-testid={`trigger-toggle-${row.engineWorkflowId}`}
        >
          <ChevronRight
            className={cn("h-4 w-4 transition-transform duration-150", isExpanded && "rotate-90")}
            aria-hidden="true"
          />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5">
          <span className="text-base font-medium leading-snug">
            {storedTogether > 1 || sentence.length === 0
              ? title
              : sentence.map((part, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: sentence parts are positional and never reorder
                    key={index}
                    className={cn(
                      part.kind === "field" && "text-primary-text",
                      part.kind === "field" && part.state === "missing" && "text-amber-600 dark:text-amber-300"
                    )}
                  >
                    {part.text}
                  </span>
                ))}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
            {!row.isEnabled && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-px text-xs text-foreground/80">Paused</span>
            )}
            {health && (
              <span className="relative z-10 shrink-0">
                <NotRunningBadge health={health} />
              </span>
            )}
            <span className="truncate">{summary}</span>
          </span>
        </div>
        <div className="relative z-10 flex h-11 w-14 shrink-0 items-center justify-center">
          <Switch
            checked={row.isEnabled}
            disabled={isSwitching}
            onCheckedChange={() => void toggleEnabled()}
            aria-label="Trigger on"
            data-testid={`trigger-enabled-${row.engineWorkflowId}`}
          />
        </div>
      </div>

      {isExpanded && (
        <div className="border-t p-4 sm:p-5">
          {read.editable ? (
            editor(read.tree)
          ) : stored?.ok ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                These triggers were saved together in one workflow and are edited together here. Their steps can't wait
                or pause.
              </p>
              {legacyEditor}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <WorkflowNotEditable reason={read.message} />
              <Button
                variant="outline"
                className="h-11 self-start sm:h-9"
                onClick={() => navigate(`/stream/workflows/${row.engineWorkflowId}`)}
              >
                <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                Open in workflow editor
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
