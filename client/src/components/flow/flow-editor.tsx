import {
  ArrowDown,
  ArrowUp,
  CircleHelp,
  Clock,
  Hourglass,
  type LucideIcon,
  Plus,
  ScrollText,
  Split,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FlowSaveBar, StepSaveFooter } from "@/components/flow/flow-save-status";
import { ObjectActionPicker } from "@/components/flow/object-action-picker";
import { StepInlineEditor } from "@/components/flow/step-inline-editor";
import { TriggerConfigPanel } from "@/components/flow/trigger-config-panel";
import { Button } from "@/components/ui/button";
import type { FlowSave } from "@/hooks/use-flow-save";
import { useToast } from "@/hooks/use-toast";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { conditionSourcesFor, type EngineConditionSupport, NO_ENGINE_CONDITION_SUPPORT } from "@/lib/condition-builder";
import type { SentencePart } from "@/lib/condition-sentence";
import { type FlowSaveView, flowSaveView } from "@/lib/flow-save";
import {
  descendantIds,
  type FlowPick,
  findStepPlace,
  type InsertPoint,
  insertAtPoint,
  insertPointKey,
  moveStepInTree,
  sameInsertPoint,
  stepForPick,
  stepNumbers,
} from "@/lib/flow-tree";
import { resolveLucideIcon } from "@/lib/resolve-lucide-icon";
import type { SceneRow } from "@/lib/scene-field-options";
import { type StepSummary, stepSummary } from "@/lib/step-summary";
import { cn } from "@/lib/utils";
import { storedExpressionProblem } from "@/lib/variable-display";
import { isDelayWait } from "@/lib/wait-config";
import { resolveCatalogAction, resolveCatalogTrigger, triggerNodeLabel } from "@/lib/workflow-node-label";
import { triggerNodeSummary } from "@/lib/workflow-node-summary";
import type { ActionPreset } from "@/lib/workflow-presets";
import {
  type BranchPath,
  findStepInTree,
  isEditableStep,
  removeStepFromTree,
  type StepNode,
  updateStepInTree,
  type WorkflowTree,
} from "@/lib/workflow-tree";
import {
  collectStepIds,
  computeAvailableVariables,
  isStepIdReferenced,
  isValidStepId,
  type VariableOption,
} from "@/lib/workflow-variables";

export interface FlowEditorProps {
  tree: WorkflowTree;
  /** Every edit, as it happens. Nothing is saved until `onCommit`. */
  onChange: (tree: WorkflowTree) => void;
  /**
   * Saves the tree. Called when an edited step closes, and right after a step is removed or
   * moved. Resolves false when saving failed, which keeps the open step open with its edits.
   */
  onCommit: (tree: WorkflowTree) => Promise<boolean>;
  catalogTriggers: CatalogTriggerRow[];
  catalogActions: CatalogActionRow[];
  catalogLoading: boolean;
  actionPresets: readonly ActionPreset[];
  resourceLabels?: Map<string, string>;
  /** The streamer's scenes, so a step naming a scene or one of its widgets reads by name. */
  scenes?: readonly SceneRow[];
  /** Why a step can't be removed from `steps`, or null when it can. */
  removeBlockedReason?: (steps: StepNode[], id: string) => string | null;
  /**
   * The "When" card, for a surface that words and edits its start itself: a chat command, or
   * an alert trigger's sentence. Build it from FlowWhenCard so it reads like the rest of the
   * flow. Without it, the card shows the tree's trigger and edits its conditions.
   */
  when?: ReactNode;
  /**
   * What the start of the flow hands its steps, offered to every step ahead of earlier steps'
   * outputs. Without it, the fields the tree's catalog trigger emits.
   */
  triggerVariables?: VariableOption[];
  /**
   * The flow's save state, for a surface whose `onCommit` really saves (`useFlowSave`). Without
   * it the steps are held for a Save button elsewhere, so the flow says nothing about saving.
   */
  save?: FlowSave;
  /** What the engine lets condition steps check beyond the catalog; nothing extra when absent. */
  conditionSupport?: EngineConditionSupport;
}

/** What every row in the flow reads and calls; held in context so nested branches need no prop chains. */
interface FlowState {
  numbers: Map<string, string>;
  expandedId: string | null;
  openPoint: InsertPoint | null;
  confirmingRemoveId: string | null;
  actionPresets: readonly ActionPreset[];
  summaryOf: (step: StepNode) => StepSummary;
  iconOf: (step: StepNode) => LucideIcon;
  placeOf: (id: string) => { index: number; count: number } | null;
  removeBlockedReason: (id: string) => string | null;
  renderEditor: (step: StepNode) => ReactNode;
  /** The open step's save state; null where the flow doesn't save itself. */
  saveView: FlowSaveView | null;
  /** The open part of the flow differs from when it was opened and from what is saved. */
  openChanged: boolean;
  discardOpen: () => void;
  toggle: (id: string) => void;
  openPicker: (point: InsertPoint) => void;
  closePicker: () => void;
  pick: (point: InsertPoint, pick: FlowPick) => void;
  move: (id: string, direction: -1 | 1) => void;
  askRemove: (id: string) => void;
  cancelRemove: () => void;
  remove: (id: string) => void;
}

const FlowContext = createContext<FlowState | null>(null);

function useFlow(): FlowState {
  const flow = useContext(FlowContext);
  if (!flow) {
    throw new Error("Flow rows must render inside FlowEditor");
  }
  return flow;
}

/** Element to focus once the next render lands, since the control that had focus may have moved or gone. */
type FocusTarget = { attribute: string; value: string } | null;

/**
 * A workflow as a vertical flow: the "When" card, then numbered steps, each condition with
 * its Then and Otherwise branches indented below it. Adding, editing and removing all happen
 * in place. At most one step is open for editing, and leaving it saves it if it changed.
 */
export function FlowEditor({
  tree,
  onChange,
  onCommit,
  catalogTriggers,
  catalogActions,
  catalogLoading,
  actionPresets,
  resourceLabels,
  scenes,
  removeBlockedReason,
  when,
  triggerVariables,
  conditionSupport = NO_ENGINE_CONDITION_SUPPORT,
  save,
}: FlowEditorProps) {
  const { toast } = useToast();
  /** The caller's save, refused while a step holds an expression that can't work. */
  const commitChecked = useCallback(
    async (next: WorkflowTree): Promise<boolean> => {
      const problem = storedExpressionProblem(next.steps);
      if (problem !== null) {
        toast({ title: "Fix this expression to save", description: problem, variant: "destructive" });
        return false;
      }
      return onCommit(next);
    },
    [onCommit, toast]
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openPoint, setOpenPoint] = useState<InsertPoint | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  /**
   * The tree as it was before the open step was opened or added, so closing it saves only when
   * something changed and discarding it has something to go back to.
   */
  const baselineRef = useRef(tree);

  useEffect(() => {
    if (!focusTarget) {
      return;
    }
    const selector = `[${focusTarget.attribute}="${CSS.escape(focusTarget.value)}"]`;
    const element = rootRef.current?.querySelector<HTMLElement>(selector);
    element?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const numbers = useMemo(() => stepNumbers(tree.steps), [tree.steps]);
  const triggerId = tree.trigger.id;

  const leaveExpanded = useCallback(async (): Promise<boolean> => {
    if (expandedId === null) {
      return true;
    }
    const current = treeRef.current;
    if (JSON.stringify(current) === JSON.stringify(baselineRef.current)) {
      setExpandedId(null);
      return true;
    }
    const ok = await commitChecked(current);
    if (ok) {
      setExpandedId(null);
    }
    return ok;
  }, [expandedId, commitChecked]);

  const toggle = useCallback(
    (id: string) => {
      void (async () => {
        if (expandedId === id) {
          await leaveExpanded();
          return;
        }
        if (await leaveExpanded()) {
          baselineRef.current = treeRef.current;
          setExpandedId(id);
        }
      })();
    },
    [expandedId, leaveExpanded]
  );

  const openPicker = useCallback(
    (point: InsertPoint) => {
      void (async () => {
        if (await leaveExpanded()) {
          setOpenPoint(point);
        }
      })();
    },
    [leaveExpanded]
  );

  const closePicker = useCallback(() => {
    if (openPoint) {
      setFocusTarget({ attribute: "data-insert-point", value: insertPointKey(openPoint) });
    }
    setOpenPoint(null);
  }, [openPoint]);

  const pick = useCallback(
    (point: InsertPoint, choice: FlowPick) => {
      let step: StepNode;
      try {
        step = stepForPick(choice, tree.steps);
      } catch (err) {
        toast({
          title: "Can't add this action",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return;
      }
      baselineRef.current = tree;
      onChange({ ...tree, steps: insertAtPoint(tree.steps, point, step) });
      setOpenPoint(null);
      setExpandedId(step.id);
      setFocusTarget({ attribute: "data-step-toggle", value: step.id });
    },
    [tree, onChange, toast]
  );

  /** Saves a structural edit at once, keeping the open step open with its baseline moved to what was saved. */
  const commitStructural = useCallback(
    async (next: WorkflowTree, closesExpanded: boolean) => {
      onChange(next);
      const ok = await commitChecked(next);
      if (closesExpanded) {
        setExpandedId(null);
      } else if (ok) {
        baselineRef.current = next;
      }
    },
    [onChange, commitChecked]
  );

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      const steps = moveStepInTree(tree.steps, id, direction);
      if (steps === tree.steps) {
        return;
      }
      const place = findStepPlace(steps, id);
      const atEdge = place !== null && (direction === -1 ? place.index === 0 : place.index === place.count - 1);
      const focusDirection = atEdge ? -direction : direction;
      setFocusTarget({ attribute: "data-step-move", value: `${id}:${focusDirection}` });
      void commitStructural({ ...tree, steps }, false);
    },
    [tree, commitStructural]
  );

  const remove = useCallback(
    (id: string) => {
      const step = findStepInTree(tree.steps, id);
      if (!step) {
        return;
      }
      const closesExpanded = expandedId === id || (expandedId !== null && descendantIds(step).includes(expandedId));
      setConfirmingRemoveId(null);
      void commitStructural({ ...tree, steps: removeStepFromTree(tree.steps, id) }, closesExpanded);
    },
    [tree, expandedId, commitStructural]
  );

  /**
   * Renaming rewrites only the step's own id. Order and branches are rebuilt from the tree on
   * save, so they follow; a `${oldId....}` written into another step's settings does not, and
   * the toast says so.
   */
  const rename = useCallback(
    (oldId: string, rawNewId: string) => {
      const newId = rawNewId.trim();
      if (newId === oldId) {
        return;
      }
      if (!newId || !isValidStepId(newId)) {
        toast({
          title: "Invalid step ID",
          description: "Use only letters, numbers, dots, underscores, and hyphens.",
          variant: "destructive",
        });
        return;
      }
      const existingIds = collectStepIds(tree.steps);
      existingIds.delete(oldId);
      if (existingIds.has(newId)) {
        toast({
          title: "Step ID already in use",
          description: `"${newId}" is already used by another step in this workflow.`,
          variant: "destructive",
        });
        return;
      }
      const referencedElsewhere = isStepIdReferenced(tree.steps, oldId);
      onChange({ ...tree, steps: updateStepInTree(tree.steps, oldId, (step) => ({ ...step, id: newId })) });
      setExpandedId(newId);
      if (referencedElsewhere) {
        toast({
          title: "Step ID renamed",
          description: `Other steps referencing \${${oldId}....} weren't updated — edit them to use \${${newId}....}.`,
        });
      }
    },
    [tree, onChange, toast]
  );

  const discardOpen = useCallback(() => {
    onChange(baselineRef.current);
    setExpandedId(null);
  }, [onChange]);

  const openPart =
    expandedId === null ? null : expandedId === triggerId ? "the trigger" : `step ${numbers.get(expandedId)}`;
  const openChanged =
    expandedId !== null &&
    (save === undefined || save.changed) &&
    JSON.stringify(tree) !== JSON.stringify(baselineRef.current);
  const saveView = save
    ? flowSaveView({
        changed: save.changed,
        phase: save.phase,
        problem: save.problem,
        notSavedYet: save.notSavedYet,
        openPart,
      })
    : null;

  const existingStepIds = useMemo(() => collectStepIds(tree.steps), [tree.steps]);

  const triggerRow = useMemo(
    () => resolveCatalogTrigger(tree.trigger, catalogTriggers),
    [tree.trigger, catalogTriggers]
  );

  const renderEditor = useCallback(
    (step: StepNode) => {
      const availableVariables = computeAvailableVariables(
        tree,
        step.id,
        catalogActions,
        catalogTriggers,
        triggerVariables
      );
      return (
        <StepInlineEditor
          step={step}
          catalogTriggers={catalogTriggers}
          catalogActions={catalogActions}
          catalogLoading={catalogLoading}
          existingStepIds={existingStepIds}
          availableVariables={availableVariables}
          conditionSources={conditionSourcesFor(availableVariables, triggerRow, conditionSupport)}
          onChange={(next) => onChange({ ...tree, steps: updateStepInTree(tree.steps, step.id, () => next) })}
          onRename={rename}
        />
      );
    },
    [
      tree,
      catalogTriggers,
      catalogActions,
      catalogLoading,
      existingStepIds,
      triggerVariables,
      onChange,
      rename,
      triggerRow,
      conditionSupport,
    ]
  );

  const state: FlowState = {
    numbers,
    expandedId,
    openPoint,
    confirmingRemoveId,
    actionPresets,
    summaryOf: (step) =>
      stepSummary(step, {
        action: step.type === "action" ? resolveCatalogAction(step, catalogActions) : undefined,
        resourceLabels,
        conditionFields:
          step.type === "condition"
            ? conditionSourcesFor(
                computeAvailableVariables(tree, step.id, catalogActions, catalogTriggers),
                triggerRow,
                conditionSupport
              ).fields
            : undefined,
        catalogTriggers,
        scenes,
      }),
    iconOf: (step) => stepIcon(step, catalogActions),
    placeOf: (id) => findStepPlace(tree.steps, id),
    removeBlockedReason: (id) => removeBlockedReason?.(tree.steps, id) ?? null,
    renderEditor,
    saveView,
    openChanged,
    discardOpen,
    toggle,
    openPicker,
    closePicker,
    pick,
    move,
    askRemove: setConfirmingRemoveId,
    cancelRemove: () => {
      if (confirmingRemoveId) {
        setFocusTarget({ attribute: "data-step-remove", value: confirmingRemoveId });
      }
      setConfirmingRemoveId(null);
    },
    remove,
  };

  return (
    <FlowContext.Provider value={state}>
      <div ref={rootRef} className="flex flex-col gap-1.5" data-testid="flow-editor">
        {save && saveView && <FlowSaveBar view={saveView} onRetry={() => void commitChecked(tree)} />}
        {when ?? (
          <TriggerWhenCard
            tree={tree}
            expanded={expandedId === triggerId}
            changed={save !== undefined && openChanged}
            onToggle={() => toggle(triggerId)}
            catalogTriggers={catalogTriggers}
            catalogLoading={catalogLoading}
            resourceLabels={resourceLabels}
            onConditionsChange={(conditions) => onChange({ ...tree, trigger: { ...tree.trigger, conditions } })}
          />
        )}
        <FlowList steps={tree.steps} path={null} />
      </div>
    </FlowContext.Provider>
  );
}

function stepIcon(step: StepNode, catalogActions: CatalogActionRow[]): LucideIcon {
  switch (step.type) {
    case "action": {
      const icon = resolveCatalogAction(step, catalogActions)?.icon;
      return icon ? resolveLucideIcon(icon) : Zap;
    }
    case "condition":
      return Split;
    case "wait":
      return isDelayWait(step.wait) ? Hourglass : Clock;
    case "log":
      return ScrollText;
    case "workflow":
      return Workflow;
    case "unknown":
      return CircleHelp;
  }
}

export interface FlowWhenCardProps {
  /** What starts the flow, as a sentence. */
  title: ReactNode;
  /** Short facts about it, shown under the title. */
  options: readonly string[];
  expanded: boolean;
  onToggle: () => void;
  /** Marks the toggle for the flow's focus handling; any id no step uses. */
  toggleId: string;
  /** The card's settings, shown while it is expanded. */
  children: ReactNode;
  /** Closing the card saves edits to its settings, so its button says so while there are any. */
  changed?: boolean;
}

/** The card at the top of a flow that says what starts it, and opens in place to change that. */
export function FlowWhenCard({
  title,
  options,
  expanded,
  onToggle,
  toggleId,
  children,
  changed = false,
}: FlowWhenCardProps) {
  return (
    <section
      aria-label="When this runs"
      className="mb-2 rounded-xl border bg-card text-card-foreground"
      data-testid="flow-when-card"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">When</span>
        <span className="min-w-0 text-base font-semibold">{title}</span>
        <Button
          type="button"
          variant={changed ? "default" : "ghost"}
          size="sm"
          className="ml-auto"
          onClick={onToggle}
          aria-expanded={expanded}
          data-step-toggle={toggleId}
          data-testid="button-flow-when-toggle"
        >
          {expanded ? (changed ? "Save changes" : "Done") : "Change"}
        </Button>
        {options.length > 0 && (
          <div className="flex w-full flex-wrap gap-2">
            {options.map((option) => (
              <span key={option} className="rounded-md bg-muted px-2.5 py-1 text-[13px] text-muted-foreground">
                {option}
              </span>
            ))}
          </div>
        )}
      </div>
      {expanded && <div className="border-t px-4 pb-4 pt-3">{children}</div>}
    </section>
  );
}

function TriggerWhenCard({
  tree,
  expanded,
  changed,
  onToggle,
  catalogTriggers,
  catalogLoading,
  resourceLabels,
  onConditionsChange,
}: {
  tree: WorkflowTree;
  expanded: boolean;
  changed: boolean;
  onToggle: () => void;
  catalogTriggers: CatalogTriggerRow[];
  catalogLoading: boolean;
  resourceLabels?: Map<string, string>;
  onConditionsChange: Parameters<typeof TriggerConfigPanel>[0]["onUpdateTriggerConditions"];
}) {
  return (
    <FlowWhenCard
      title={triggerNodeLabel(tree.trigger, catalogTriggers)}
      options={triggerNodeSummary(tree.trigger, catalogTriggers, resourceLabels)}
      expanded={expanded}
      changed={changed}
      onToggle={onToggle}
      toggleId={tree.trigger.id}
    >
      {catalogLoading ? (
        <p className="text-sm text-muted-foreground">Loading catalog…</p>
      ) : (
        <TriggerConfigPanel
          node={tree.trigger}
          catalog={catalogTriggers}
          onUpdateTriggerConditions={onConditionsChange}
        />
      )}
    </FlowWhenCard>
  );
}

function FlowList({ steps, path }: { steps: StepNode[]; path: BranchPath }) {
  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((step, index) => (
        <div key={step.id} className="flex flex-col gap-1.5">
          <InsertSlot point={{ path, index }} beforeStepId={step.id} />
          <StepRow step={step} />
          {step.type === "condition" && (
            <div className="ml-4 flex flex-col gap-1.5 border-l-2 pl-3.5">
              <BranchLabel>Then</BranchLabel>
              <FlowList steps={step.thenBranch} path={{ parentId: step.id, branch: "thenBranch" }} />
              <BranchLabel>Otherwise</BranchLabel>
              <FlowList steps={step.elseBranch} path={{ parentId: step.id, branch: "elseBranch" }} />
            </div>
          )}
        </div>
      ))}
      <InsertSlot point={{ path, index: steps.length }} />
    </div>
  );
}

function BranchLabel({ children }: { children: ReactNode }) {
  return <div className="pt-2 text-[13px] font-semibold text-muted-foreground">{children}</div>;
}

/**
 * Where a step can be added. The point after a list's last step always shows; the points
 * before each step stay out of sight until hovered or reached with Tab, so the flow reads as
 * a list of steps rather than a list of buttons.
 */
function InsertSlot({ point, beforeStepId }: { point: InsertPoint; beforeStepId?: string }) {
  const flow = useFlow();
  const compact = beforeStepId !== undefined;
  const key = insertPointKey(point);
  const inBranch = point.path !== null;

  if (flow.openPoint && sameInsertPoint(flow.openPoint, point)) {
    return (
      <ObjectActionPicker
        presets={flow.actionPresets}
        heading={inBranch ? "Add a step to this branch" : "Add a step"}
        onPick={(choice) => flow.pick(point, choice)}
        onCancel={flow.closePicker}
      />
    );
  }

  const position = beforeStepId === undefined ? undefined : flow.numbers.get(beforeStepId);
  const label = position ? `Add a step before step ${position}` : undefined;
  return (
    <div className={cn("flex", compact && "group -my-1 h-4 items-center focus-within:h-auto")}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 gap-2 rounded-full px-2.5 text-[13px] font-normal text-muted-foreground hover:text-foreground",
          compact && "h-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        )}
        onClick={() => flow.openPicker(point)}
        aria-label={label}
        data-insert-point={key}
        data-testid={`button-flow-add-${key}`}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {compact ? "Add here" : "Add a step"}
      </Button>
    </div>
  );
}

function StepRow({ step }: { step: StepNode }) {
  const flow = useFlow();
  const number = flow.numbers.get(step.id) ?? "";
  const summary = flow.summaryOf(step);
  const Icon = flow.iconOf(step);
  const expanded = flow.expandedId === step.id;
  const editable = isEditableStep(step);
  const place = flow.placeOf(step.id);
  const blocked = flow.removeBlockedReason(step.id);
  const confirming = flow.confirmingRemoveId === step.id;
  const nested = step.type === "condition" ? descendantIds(step).length : 0;

  const text = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <span className="truncate text-sm font-medium">
        {summary.parts ? <SentenceText parts={summary.parts} /> : summary.title}
      </span>
      {summary.details.length > 0 && (
        <span className="truncate text-xs text-muted-foreground">{summary.details.join(" · ")}</span>
      )}
    </span>
  );

  return (
    <div
      className={cn("rounded-[10px] border bg-card text-card-foreground", expanded && "border-primary/40")}
      data-testid={`flow-step-${step.id}`}
    >
      <div className="flex flex-wrap items-center gap-3 py-2.5 pl-3 pr-2">
        <span className="min-w-7 text-xs font-semibold text-muted-foreground" aria-hidden="true">
          {number}
        </span>
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        {editable ? (
          <button
            type="button"
            className="flex min-w-[200px] flex-1 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => flow.toggle(step.id)}
            aria-expanded={expanded}
            aria-label={`Step ${number}: ${summary.title}`}
            data-step-toggle={step.id}
            data-testid={`button-flow-step-${step.id}`}
          >
            {text}
          </button>
        ) : (
          <div
            className="flex min-w-[200px] flex-1 items-center"
            data-testid={`text-flow-step-not-editable-${step.id}`}
          >
            {text}
          </div>
        )}
        {summary.needs && (
          <span
            className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200"
            data-testid={`badge-flow-needs-${step.id}`}
          >
            Needs: {summary.needs.join(", ")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {editable && !(expanded && flow.saveView) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => flow.toggle(step.id)} tabIndex={-1}>
              {expanded ? "Done" : "Settings"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            disabled={!place || place.index === 0}
            onClick={() => flow.move(step.id, -1)}
            aria-label={`Move step ${number} up`}
            data-step-move={`${step.id}:-1`}
            data-testid={`button-flow-move-up-${step.id}`}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            disabled={!place || place.index === place.count - 1}
            onClick={() => flow.move(step.id, 1)}
            aria-label={`Move step ${number} down`}
            data-step-move={`${step.id}:1`}
            data-testid={`button-flow-move-down-${step.id}`}
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={() => flow.askRemove(step.id)}
            aria-label={blocked ? `Can't remove step ${number}: ${blocked}` : `Remove step ${number}`}
            data-step-remove={step.id}
            data-testid={`button-flow-remove-${step.id}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {confirming && (
        <RemoveConfirm
          message={
            nested > 0
              ? `Remove step ${number} and the ${nested} ${nested === 1 ? "step" : "steps"} inside it?`
              : `Remove step ${number}?`
          }
          onConfirm={() => flow.remove(step.id)}
          onCancel={flow.cancelRemove}
        />
      )}
      {expanded && (
        <div className="flex flex-col gap-4 border-t px-4 pb-4 pt-3">
          {flow.renderEditor(step)}
          {flow.saveView && (
            <StepSaveFooter
              view={flow.saveView}
              changed={flow.openChanged}
              onSave={() => flow.toggle(step.id)}
              onDiscard={flow.discardOpen}
              onClose={() => flow.toggle(step.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** A step's sentence, with what it still needs marked and the values it uses set apart. */
function SentenceText({ parts }: { parts: readonly SentencePart[] }) {
  return (
    <>
      {parts.map((part, index) => {
        const key = `${index}-${part.text}`;
        if (part.kind === "text") {
          return <span key={key}>{part.text}</span>;
        }
        return (
          <span
            key={key}
            className={cn(
              part.state === "missing" && "text-amber-700 dark:text-amber-300",
              part.state === "value" && "text-primary-text",
              part.state === "variable" && "font-mono text-[13px] text-primary-text",
              part.state === "default" && "text-muted-foreground"
            )}
          >
            {part.state === "variable" ? `{${part.text}}` : part.text}
          </span>
        );
      })}
    </>
  );
}

function RemoveConfirm({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 border-t bg-destructive/5 px-4 py-2.5"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <span className="mr-auto text-sm">{message}</span>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} data-testid="button-flow-remove-cancel">
        Keep it
      </Button>
      <Button
        ref={confirmRef}
        type="button"
        variant="destructive"
        size="sm"
        onClick={onConfirm}
        data-testid="button-flow-remove-confirm"
      >
        Remove
      </Button>
    </div>
  );
}
