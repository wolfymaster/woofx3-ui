import { FORM_KIND } from "@shared/resource-kinds";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { FlowSaveBar, StepSaveFooter } from "@/components/flow/flow-save-status";
import { ObjectActionPicker } from "@/components/flow/object-action-picker";
import { StepInlineEditor } from "@/components/flow/step-inline-editor";
import { Button } from "@/components/ui/button";
import { useResourceInstancesOfKind } from "@/engine/hooks/use-module-resources";
import {
  type FlowFocusTarget,
  type FlowInteractionFocus,
  type FlowInteractionWording,
  useFlowInteraction,
} from "@/hooks/use-flow-interaction";
import type { FlowSave } from "@/hooks/use-flow-save";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import {
  type ConditionSources,
  conditionSourcesFor,
  type EngineConditionSupport,
  NO_ENGINE_CONDITION_SUPPORT,
} from "@/lib/condition-builder";
import type { SentencePart } from "@/lib/condition-sentence";
import type { FlowSaveView } from "@/lib/flow-save";
import { descendantIds, type FlowPick, type InsertPoint, insertPointKey, sameInsertPoint } from "@/lib/flow-tree";
import { FORM_SUBMITTED_EVENT, formAnswerVariables } from "@/lib/form-kind";
import type { SceneRow } from "@/lib/scene-field-options";
import { type StepSummary, stepSummary } from "@/lib/step-summary";
import { cn } from "@/lib/utils";
import { resolveCatalogAction, resolveCatalogTrigger } from "@/lib/workflow-node-label";
import type { ActionPreset } from "@/lib/workflow-presets";
import {
  type BranchPath,
  isEditableStep,
  type StepNode,
  stepKindLabel,
  updateStepInTree,
  type WorkflowTree,
} from "@/lib/workflow-tree";
import { collectStepIds, computeAvailableVariables, type VariableOption } from "@/lib/workflow-variables";

/**
 * The alert's sentence: "When …, then …, if … otherwise …". Each phrase is a button that
 * expands its own editor directly beneath it, in the page flow. The tree behind it is the
 * same one the full workflow editor uses, so branching, waits and nested steps survive a
 * round trip and the two views never disagree.
 */
export interface TriggerSentenceProps {
  when: ReactNode;
  tree: WorkflowTree;
  onChange: (tree: WorkflowTree) => void;
  onCommit: (tree: WorkflowTree) => Promise<boolean>;
  save: FlowSave;
  catalogTriggers: CatalogTriggerRow[];
  catalogActions: CatalogActionRow[];
  catalogLoading: boolean;
  actionPresets: readonly ActionPreset[];
  resourceLabels?: Map<string, string>;
  scenes?: readonly SceneRow[];
  conditionSupport?: EngineConditionSupport;
  triggerVariables?: VariableOption[];
  removeBlockedReason?: (steps: StepNode[], id: string) => string | null;
  /** A construct the sentence can't draw sends the reader to the one Advanced disclosure. */
  onOpenAdvanced: () => void;
}

/**
 * A phrase hands focus to the section it opened and returns it to the phrase on the way out.
 * The numbered flow leaves focus on the control the reader clicked instead.
 */
const SENTENCE_FOCUS: FlowInteractionFocus = {
  open: (id): FlowFocusTarget => ({ attribute: "data-step-section", value: id }),
  leave: (id): FlowFocusTarget => ({ attribute: "data-step-toggle", value: id }),
};

const SENTENCE_WORDING: FlowInteractionWording = {
  alreadyUsed: (newId) => `"${newId}" is already used by another step.`,
  referencedElsewhere: (oldId, newId) => `References to "${oldId}" weren't updated — edit them to use "${newId}".`,
};

interface SentenceState {
  expandedId: string | null;
  openPoint: InsertPoint | null;
  confirmingRemoveId: string | null;
  actionPresets: readonly ActionPreset[];
  summaryOf: (step: StepNode) => StepSummary;
  /** A step's short name for its settings header, so the header doesn't repeat the sentence. */
  shortLabelOf: (step: StepNode) => string;
  renderEditor: (step: StepNode) => ReactNode;
  placeOf: (id: string) => { index: number; count: number } | null;
  removeBlockedReason: (id: string) => string | null;
  saveView: FlowSaveView;
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
  onOpenAdvanced: () => void;
}

const SentenceContext = createContext<SentenceState | null>(null);

function useSentence(): SentenceState {
  const state = useContext(SentenceContext);
  if (!state) {
    throw new Error("Sentence phrases must render inside TriggerSentence");
  }
  return state;
}

export function TriggerSentence({
  when,
  tree,
  onChange,
  onCommit,
  save,
  catalogTriggers,
  catalogActions,
  catalogLoading,
  actionPresets,
  resourceLabels,
  scenes,
  conditionSupport = NO_ENGINE_CONDITION_SUPPORT,
  triggerVariables,
  removeBlockedReason,
  onOpenAdvanced,
}: TriggerSentenceProps) {
  const interaction = useFlowInteraction({
    tree,
    onChange,
    onCommit,
    save,
    removeBlockedReason,
    focus: SENTENCE_FOCUS,
    wording: SENTENCE_WORDING,
  });

  const existingStepIds = useMemo(() => collectStepIds(tree.steps), [tree.steps]);
  const triggerRow = useMemo(
    () => resolveCatalogTrigger(tree.trigger, catalogTriggers),
    [tree.trigger, catalogTriggers]
  );
  const formRows = useResourceInstancesOfKind(tree.trigger.event === FORM_SUBMITTED_EVENT ? FORM_KIND : null);
  const formAnswers = useMemo(() => formAnswerVariables(tree.trigger, formRows ?? []), [tree.trigger, formRows]);

  const availableFor = useCallback(
    (step: StepNode): VariableOption[] =>
      computeAvailableVariables(tree, step.id, catalogActions, catalogTriggers, triggerVariables, formAnswers),
    [tree, catalogActions, catalogTriggers, triggerVariables, formAnswers]
  );

  const summaryOf = useCallback(
    (step: StepNode): StepSummary =>
      stepSummary(step, {
        action: step.type === "action" ? resolveCatalogAction(step, catalogActions) : undefined,
        resourceLabels,
        conditionFields:
          step.type === "condition"
            ? conditionSourcesFor(availableFor(step), triggerRow, conditionSupport).fields
            : undefined,
        catalogTriggers,
        scenes,
      }),
    [catalogActions, resourceLabels, availableFor, triggerRow, conditionSupport, catalogTriggers, scenes]
  );

  const renderEditor = useCallback(
    (step: StepNode) => {
      const sources: ConditionSources = conditionSourcesFor(availableFor(step), triggerRow, conditionSupport);
      return (
        <StepInlineEditor
          step={step}
          catalogTriggers={catalogTriggers}
          catalogActions={catalogActions}
          catalogLoading={catalogLoading}
          existingStepIds={existingStepIds}
          availableVariables={availableFor(step)}
          conditionSources={sources}
          onChange={(next) => onChange({ ...tree, steps: updateStepInTree(tree.steps, step.id, () => next) })}
          onRename={interaction.rename}
          showStepId={false}
        />
      );
    },
    [
      catalogTriggers,
      catalogActions,
      catalogLoading,
      existingStepIds,
      availableFor,
      triggerRow,
      conditionSupport,
      onChange,
      tree,
      interaction.rename,
    ]
  );

  const shortLabelOf = useCallback(
    (step: StepNode): string => {
      if (step.type === "action") {
        return resolveCatalogAction(step, catalogActions)?.name?.trim() || stepKindLabel(step);
      }
      return stepKindLabel(step);
    },
    [catalogActions]
  );

  const state: SentenceState = {
    ...interaction,
    actionPresets,
    summaryOf,
    shortLabelOf,
    renderEditor,
    onOpenAdvanced,
  };

  return (
    <SentenceContext.Provider value={state}>
      <div ref={interaction.rootRef} className="flex flex-col gap-2" data-testid="trigger-sentence">
        <div className="text-[17px] leading-[1.7] tracking-[-0.01em] text-foreground">
          {when}
          <Connector>then</Connector>
          <SentenceList steps={tree.steps} path={null} />
        </div>
        <FlowSaveBar view={interaction.saveView} hidden={interaction.expandedId !== null} onRetry={interaction.retry} />
      </div>
    </SentenceContext.Provider>
  );
}

function Connector({ children }: { children: ReactNode }) {
  return <span className="mr-1.5 text-muted-foreground/80">{children}</span>;
}

function SentenceList({ steps, path }: { steps: StepNode[]; path: BranchPath }) {
  return (
    <>
      {steps.map((step, index) => (
        <span key={step.id} className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1 align-baseline">
          {index > 0 && <Connector>then</Connector>}
          <Phrase step={step} index={index} />
        </span>
      ))}
      <AddPhrase point={{ path, index: steps.length }} />
    </>
  );
}

function Phrase({ step, index }: { step: StepNode; index: number }) {
  const flow = useSentence();
  const summary = flow.summaryOf(step);
  const expanded = flow.expandedId === step.id;
  const editable = isEditableStep(step);
  const place = flow.placeOf(step.id);
  const blocked = flow.removeBlockedReason(step.id);
  const confirming = flow.confirmingRemoveId === step.id;
  const nested = step.type === "condition" ? descendantIds(step).length : 0;

  // A construct the sentence can't draw stays visible; its only action is the one escape hatch.
  if (!editable) {
    return (
      <button
        type="button"
        className="phrase inline-flex items-baseline gap-1 rounded-md px-1 text-muted-foreground"
        onClick={flow.onOpenAdvanced}
        aria-label={`${summary.title}. More steps in the workflow editor`}
        data-testid={`sentence-uneditable-${step.id}`}
      >
        {summary.title}
        <span className="text-xs underline underline-offset-2">Edit in workflow editor</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className={cn("phrase inline-block rounded-md px-1 font-medium", expanded && "phrase-open")}
        onClick={() => flow.toggle(step.id)}
        aria-expanded={expanded}
        aria-label={`Step ${index + 1}: ${summary.title}`}
        data-step-toggle={step.id}
        data-testid={`sentence-phrase-${step.id}`}
      >
        {summary.parts ? <SentenceParts parts={summary.parts} /> : summary.title}
      </button>
      {confirming && (
        <span className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-[13px]">
          {nested > 0 ? `Remove this and the ${nested} step${nested === 1 ? "" : "s"} inside?` : "Remove this step?"}
          <Button type="button" size="sm" variant="ghost" onClick={flow.cancelRemove}>
            Keep
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => flow.remove(step.id)}
            data-testid={`confirm-remove-${step.id}`}
          >
            Remove
          </Button>
        </span>
      )}
      {expanded && (
        <div
          className="phrase-section w-full"
          data-step-section={step.id}
          tabIndex={-1}
          data-testid={`sentence-section-${step.id}`}
        >
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-auto text-[13px] font-medium" data-testid={`sentence-section-label-${step.id}`}>
              {flow.shortLabelOf(step)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              disabled={!place || place.index === 0}
              onClick={() => flow.move(step.id, -1)}
              aria-label="Move this step earlier"
              data-step-move={`${step.id}:-1`}
              data-testid={`sentence-move-up-${step.id}`}
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
              aria-label="Move this step later"
              data-step-move={`${step.id}:1`}
              data-testid={`sentence-move-down-${step.id}`}
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
              aria-label={blocked ? `Can't remove this step: ${blocked}` : "Remove this step"}
              data-step-remove={step.id}
              data-testid={`sentence-remove-${step.id}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {flow.renderEditor(step)}
          <StepSaveFooter
            view={flow.saveView}
            changed={flow.openChanged}
            onSave={() => flow.toggle(step.id)}
            onDiscard={flow.discardOpen}
            onClose={() => flow.toggle(step.id)}
          />
        </div>
      )}
      {step.type === "condition" && (
        <span className="ml-3 inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1 border-l-2 pl-3 align-baseline">
          <Connector>then</Connector>
          <SentenceList steps={step.thenBranch} path={{ parentId: step.id, branch: "thenBranch" }} />
          <Connector>otherwise</Connector>
          <SentenceList steps={step.elseBranch} path={{ parentId: step.id, branch: "elseBranch" }} />
        </span>
      )}
    </>
  );
}

function AddPhrase({ point }: { point: InsertPoint }) {
  const flow = useSentence();
  const inBranch = point.path !== null;
  if (flow.openPoint && sameInsertPoint(flow.openPoint, point)) {
    return (
      <div className="phrase-section w-full" data-testid={`sentence-picker-${insertPointKey(point)}`}>
        <ObjectActionPicker
          presets={flow.actionPresets}
          heading={inBranch ? "Add a step to this branch" : "Add a step"}
          onPick={(choice) => flow.pick(point, choice)}
          onCancel={flow.closePicker}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      className="phrase inline-flex items-baseline gap-1 rounded-md px-1 text-muted-foreground hover:text-foreground"
      onClick={() => flow.openPicker(point)}
      aria-label={inBranch ? "Add a step to this branch" : "Add a step"}
      data-insert-point={insertPointKey(point)}
      data-testid={`sentence-add-${insertPointKey(point)}`}
    >
      <Plus className="h-3.5 w-3.5 self-center" aria-hidden="true" />
      {inBranch ? "add a step" : "add a step"}
    </button>
  );
}

function SentenceParts({ parts }: { parts: readonly SentencePart[] }) {
  const seen = new Map<string, number>();
  const entries = parts.map((part) => {
    const base = part.kind === "field" ? `field:${part.fieldId}` : `text:${part.text}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { part, key: `${base}:${occurrence}` };
  });
  return (
    <>
      {entries.map(({ part, key }) => (
        <span
          key={key}
          className={cn(part.kind === "field" && part.state === "missing" && "text-amber-600 dark:text-amber-300")}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}
