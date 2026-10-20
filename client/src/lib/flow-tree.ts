import type { FlowStepKind } from "@/lib/action-objects";
import { DEFAULT_DELAY_MS } from "@/lib/wait-config";
import type { ActionPreset } from "@/lib/workflow-presets";
import { presetToActionNode } from "@/lib/workflow-presets-json";
import { type BranchPath, insertStepInTree, type StepNode } from "@/lib/workflow-tree";
import { collectStepIds, generateStepId } from "@/lib/workflow-variables";

/** A place a new step can go: before the step at `index` in one list, or at its end when `index` is the list's length. */
export interface InsertPoint {
  path: BranchPath;
  index: number;
}

/** A stable name for an insert point, for React keys and for telling which one is open. */
export function insertPointKey(point: InsertPoint): string {
  const list = point.path === null ? "root" : `${point.path.parentId}/${point.path.branch}`;
  return `${list}#${point.index}`;
}

export function sameInsertPoint(a: InsertPoint, b: InsertPoint): boolean {
  return insertPointKey(a) === insertPointKey(b);
}

/** What the picker hands back; mirrors `ObjectActionPick` without depending on the component. */
export type FlowPick =
  | { kind: "action"; preset: ActionPreset; parameters: Record<string, unknown> }
  | { kind: FlowStepKind };

/**
 * The step a pick becomes. Its id is readable and unused anywhere in `steps`. An action
 * starts with the parameters the picker chose, which already hold the settings' defaults.
 * Throws when the action cannot be written as a task (see presetToActionNode).
 */
export function stepForPick(pick: FlowPick, steps: StepNode[]): StepNode {
  const ids = collectStepIds(steps);
  switch (pick.kind) {
    case "action": {
      const node = presetToActionNode(pick.preset, generateStepId(pick.preset.name, ids));
      return { ...node, parameters: pick.parameters };
    }
    case "pause":
      return { type: "wait", id: generateStepId("pause", ids), wait: { type: "delay", durationMs: DEFAULT_DELAY_MS } };
    case "wait":
      return { type: "wait", id: generateStepId("wait", ids), wait: { type: "event", event: "" } };
    case "condition":
      return {
        type: "condition",
        id: generateStepId("condition", ids),
        conditions: [],
        thenBranch: [],
        elseBranch: [],
      };
  }
}

export function insertAtPoint(steps: StepNode[], point: InsertPoint, step: StepNode): StepNode[] {
  return insertStepInTree(steps, point.path, point.index, step);
}

/** Where a step sits: the list holding it, its index there and that list's length. */
export interface StepPlace {
  path: BranchPath;
  index: number;
  count: number;
}

export function findStepPlace(steps: StepNode[], id: string, path: BranchPath = null): StepPlace | null {
  const index = steps.findIndex((step) => step.id === id);
  if (index >= 0) {
    return { path, index, count: steps.length };
  }
  for (const step of steps) {
    if (step.type !== "condition") {
      continue;
    }
    const found =
      findStepPlace(step.thenBranch, id, { parentId: step.id, branch: "thenBranch" }) ??
      findStepPlace(step.elseBranch, id, { parentId: step.id, branch: "elseBranch" });
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Swaps the step with its neighbour above (-1) or below (1) in its own list. A step never
 * leaves its list this way, so a branch keeps its steps; at either end nothing changes.
 */
export function moveStepInTree(steps: StepNode[], id: string, direction: -1 | 1): StepNode[] {
  const index = steps.findIndex((step) => step.id === id);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) {
      return steps;
    }
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  let changed = false;
  const next = steps.map((step) => {
    if (step.type !== "condition") {
      return step;
    }
    const thenBranch = moveStepInTree(step.thenBranch, id, direction);
    const elseBranch = moveStepInTree(step.elseBranch, id, direction);
    if (thenBranch === step.thenBranch && elseBranch === step.elseBranch) {
      return step;
    }
    changed = true;
    return { ...step, thenBranch, elseBranch };
  });
  return changed ? next : steps;
}

/**
 * Each step's number as the flow shows it: 1, 2, 3 at the top, and 2.1, 2.2 under step 2.
 * Numbering runs on from the Then branch into the Otherwise branch, so every number names
 * one step.
 */
export function stepNumbers(steps: StepNode[]): Map<string, string> {
  const numbers = new Map<string, string>();
  const walk = (list: StepNode[], prefix: string, start: number): number => {
    let n = start;
    for (const step of list) {
      n += 1;
      const number = prefix ? `${prefix}.${n}` : String(n);
      numbers.set(step.id, number);
      if (step.type === "condition") {
        const afterThen = walk(step.thenBranch, number, 0);
        walk(step.elseBranch, number, afterThen);
      }
    }
    return n;
  };
  walk(steps, "", 0);
  return numbers;
}

/** Every step id inside a condition's branches, at any depth. */
export function descendantIds(step: StepNode): string[] {
  if (step.type !== "condition") {
    return [];
  }
  return [...step.thenBranch, ...step.elseBranch].flatMap((child) => [child.id, ...descendantIds(child)]);
}
