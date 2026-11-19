import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { FlowSave } from "@/hooks/use-flow-save";
import { useToast } from "@/hooks/use-toast";
import { type FlowSaveView, flowSaveView } from "@/lib/flow-save";
import {
  descendantIds,
  type FlowPick,
  findStepPlace,
  type InsertPoint,
  insertAtPoint,
  insertPointKey,
  moveStepInTree,
  stepForPick,
} from "@/lib/flow-tree";
import { storedExpressionProblem } from "@/lib/variable-display";
import {
  findStepInTree,
  removeStepFromTree,
  type StepNode,
  updateStepInTree,
  type WorkflowTree,
} from "@/lib/workflow-tree";
import { collectStepIds, isStepIdReferenced, isValidStepId } from "@/lib/workflow-variables";

/**
 * Every trigger the streamer writes is a workflow: presets from the engine catalog describe
 * capability, while the tree edited here holds the configuration. There is no third store, so
 * ordering, merging and health keep coming from the tree alone.
 *
 * The one rule callers need: at most one step is open. Leaving it commits only when the tree
 * differs from its baseline, a failed commit keeps it open, and a caller whose tree was replaced
 * during the save resolves false. Both the sentence and the numbered flow use this same machine.
 */

/** Element to focus once the next render lands; the clicked control may have moved or gone. */
export type FlowFocusTarget = { attribute: string; value: string } | null;

/** Where a view returns focus as an inline editor opens and closes. */
export interface FlowInteractionFocus {
  open?: (id: string) => FlowFocusTarget;
  leave?: (id: string) => FlowFocusTarget;
}

/** The two rename warnings are worded for the view that shows them. */
export interface FlowInteractionWording {
  alreadyUsed: (newId: string) => string;
  referencedElsewhere: (oldId: string, newId: string) => string;
}

/**
 * What a view hands the shared machine. Presets describe capability; this `tree`
 * is the workflow holding the configuration, and there is no third store — so
 * ordering, merging and health keep coming from it alone.
 */
export interface FlowInteractionArgs {
  tree: WorkflowTree;
  onChange: (tree: WorkflowTree) => void;
  onCommit: (tree: WorkflowTree) => Promise<boolean>;
  save?: FlowSave;
  removeBlockedReason?: (steps: StepNode[], id: string) => string | null;
  focus?: FlowInteractionFocus;
  wording?: FlowInteractionWording;
  /** The numbered flow also needs the surface-wide save flag before calling an open step changed. */
  openChangedIncludesSurface?: boolean;
}

const DEFAULT_WORDING: FlowInteractionWording = {
  alreadyUsed: (newId) => `"${newId}" is already used by another step in this workflow.`,
  referencedElsewhere: (oldId, newId) =>
    `Other steps referencing \${${oldId}....} weren't updated — edit them to use \${${newId}....}.`,
};

export interface FlowInteraction {
  /** Attach to the view's root so focus requests can find the control that moved. */
  rootRef: RefObject<HTMLDivElement>;
  expandedId: string | null;
  openPoint: InsertPoint | null;
  confirmingRemoveId: string | null;
  saveView: FlowSaveView | null;
  /** The open part differs from when it was opened and from what is saved. */
  openChanged: boolean;
  removeBlockedReason: (id: string) => string | null;
  placeOf: (id: string) => { index: number; count: number } | null;
  toggle: (id: string) => void;
  openPicker: (point: InsertPoint) => void;
  closePicker: () => void;
  pick: (point: InsertPoint, choice: FlowPick) => void;
  move: (id: string, direction: -1 | 1) => void;
  askRemove: (id: string) => void;
  cancelRemove: () => void;
  remove: (id: string) => void;
  rename: (oldId: string, newId: string) => void;
  discardOpen: () => void;
  retry: () => void;
}

export function useFlowInteraction(
  args: FlowInteractionArgs & { save: FlowSave }
): FlowInteraction & { saveView: FlowSaveView };
export function useFlowInteraction(args: FlowInteractionArgs): FlowInteraction;
export function useFlowInteraction({
  tree,
  onChange,
  onCommit,
  save,
  removeBlockedReason,
  focus,
  wording = DEFAULT_WORDING,
  openChangedIncludesSurface = false,
}: FlowInteractionArgs): FlowInteraction {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openPoint, setOpenPoint] = useState<InsertPoint | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FlowFocusTarget>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  /** The tree as it was when the open step was opened, for "no changes" and Discard. */
  const baselineRef = useRef(tree);

  useEffect(() => {
    if (!focusTarget) {
      return;
    }
    const candidates = rootRef.current?.querySelectorAll<HTMLElement>(`[${focusTarget.attribute}]`);
    for (const node of candidates ?? []) {
      if (node.getAttribute(focusTarget.attribute) === focusTarget.value) {
        node.focus();
        break;
      }
    }
    setFocusTarget(null);
  }, [focusTarget]);

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
          if (await leaveExpanded()) {
            const target = focus?.leave?.(id);
            if (target) {
              setFocusTarget(target);
            }
          }
          return;
        }
        if (await leaveExpanded()) {
          baselineRef.current = treeRef.current;
          setOpenPoint(null);
          setExpandedId(id);
          const target = focus?.open?.(id);
          if (target) {
            setFocusTarget(target);
          }
        }
      })();
    },
    [expandedId, leaveExpanded, focus]
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
      setFocusTarget({ attribute: "data-step-move", value: `${id}:${atEdge ? -direction : direction}` });
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
   * save, so they follow; a reference written into another step's settings does not.
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
      const ids = collectStepIds(tree.steps);
      ids.delete(oldId);
      if (ids.has(newId)) {
        toast({ title: "Step ID already in use", description: wording.alreadyUsed(newId), variant: "destructive" });
        return;
      }
      const referencedElsewhere = isStepIdReferenced(tree.steps, oldId);
      onChange({ ...tree, steps: updateStepInTree(tree.steps, oldId, (step) => ({ ...step, id: newId })) });
      setExpandedId(newId);
      if (referencedElsewhere) {
        toast({ title: "Step ID renamed", description: wording.referencedElsewhere(oldId, newId) });
      }
    },
    [tree, onChange, toast, wording]
  );

  const discardOpen = useCallback(() => {
    if (expandedId !== null) {
      const target = focus?.leave?.(expandedId);
      if (target) {
        setFocusTarget(target);
      }
    }
    onChange(baselineRef.current);
    setExpandedId(null);
  }, [onChange, expandedId, focus]);

  const cancelRemove = useCallback(() => {
    if (confirmingRemoveId) {
      setFocusTarget({ attribute: "data-step-remove", value: confirmingRemoveId });
    }
    setConfirmingRemoveId(null);
  }, [confirmingRemoveId]);

  const openChanged =
    expandedId !== null &&
    (!openChangedIncludesSurface || save === undefined || save.changed) &&
    JSON.stringify(tree) !== JSON.stringify(baselineRef.current);
  const saveView = save
    ? flowSaveView({
        changed: save.changed,
        phase: save.phase,
        problem: save.problem,
        notSavedYet: save.notSavedYet,
      })
    : null;

  return {
    rootRef,
    expandedId,
    openPoint,
    confirmingRemoveId,
    saveView,
    openChanged,
    removeBlockedReason: (id: string) => removeBlockedReason?.(tree.steps, id) ?? null,
    placeOf: (id: string) => findStepPlace(tree.steps, id),
    toggle,
    openPicker,
    closePicker,
    pick,
    move,
    askRemove: setConfirmingRemoveId,
    cancelRemove,
    remove,
    rename,
    discardOpen,
    retry: () => void commitChecked(tree),
  };
}
