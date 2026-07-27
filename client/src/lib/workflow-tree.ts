import type { ConditionConfig, TaskDefinition, WaitConfig, WorkflowDefinition } from "@woofx3/api";
import type { TriggerConfig as EngineTriggerConfig } from "@woofx3/api/workflow-definition";

/** Engine embeds JSON-Schema-style `$ref`/`function` fields the shared TS schema doesn't declare. */
type TriggerBlockWithRef = EngineTriggerConfig & { $ref?: string };
type TaskWithRef = TaskDefinition & { $ref?: string; function?: string };

export interface WorkflowTree {
  trigger: TriggerNode;
  steps: StepNode[];
}

export interface TriggerNode {
  type: "trigger";
  id: string;
  event: string;
  conditions: ConditionConfig[];
  /** Canonical catalog ref (e.g. `twitch_platform:trigger:redeem.channelpoints`), when set at creation time. */
  ref?: string;
}

export type StepNode = ActionNode | ConditionNode | WaitNode;

export interface ActionNode {
  type: "action";
  id: string;
  action: string;
  parameters: Record<string, unknown>;
  /** Canonical catalog ref, when set at creation time. */
  ref?: string;
  /** Specific registered function/handler call name, for `action: "function"` tasks. */
  function?: string;
}

export interface ConditionNode {
  type: "condition";
  id: string;
  conditions: ConditionConfig[];
  thenBranch: StepNode[];
  elseBranch: StepNode[];
}

export interface WaitNode {
  type: "wait";
  id: string;
  wait: WaitConfig;
}

function buildTaskMap(tasks: TaskDefinition[]): Map<string, TaskDefinition> {
  const map = new Map<string, TaskDefinition>();
  for (const task of tasks) {
    map.set(task.id, task);
  }
  return map;
}

function getRootTasks(tasks: TaskDefinition[]): TaskDefinition[] {
  const referenced = new Set<string>();
  for (const task of tasks) {
    for (const ref of task.onTrue ?? []) {
      referenced.add(ref);
    }
    for (const ref of task.onFalse ?? []) {
      referenced.add(ref);
    }
  }
  return tasks.filter((t) => !referenced.has(t.id));
}

function convertTaskToNode(task: TaskDefinition, taskMap: Map<string, TaskDefinition>): StepNode {
  if (task.type === "action") {
    const withRef = task as TaskWithRef;
    return {
      type: "action",
      id: task.id,
      action: task.action ?? "",
      parameters: task.parameters ?? {},
      ref: withRef.$ref,
      function: withRef.function,
    };
  }

  if (task.type === "condition") {
    const thenBranch: StepNode[] = [];
    const elseBranch: StepNode[] = [];

    for (const childId of task.onTrue ?? []) {
      const childTask = taskMap.get(childId);
      if (childTask) {
        thenBranch.push(convertTaskToNode(childTask, taskMap));
      }
    }

    for (const childId of task.onFalse ?? []) {
      const childTask = taskMap.get(childId);
      if (childTask) {
        elseBranch.push(convertTaskToNode(childTask, taskMap));
      }
    }

    return {
      type: "condition",
      id: task.id,
      conditions: task.conditions ?? [],
      thenBranch,
      elseBranch,
    };
  }

  if (task.type === "wait") {
    return {
      type: "wait",
      id: task.id,
      wait: task.wait ?? { type: "event", event: "" },
    };
  }

  return {
    type: "action",
    id: task.id,
    action: "",
    parameters: {},
  };
}

export function definitionToTree(def: WorkflowDefinition): WorkflowTree {
  const trigger: TriggerNode = {
    type: "trigger",
    id: "__trigger",
    event: def.trigger.type === "event" ? def.trigger.event : "",
    conditions: def.trigger.conditions ?? [],
    ref: (def.trigger as TriggerBlockWithRef).$ref,
  };

  const taskMap = buildTaskMap(def.tasks);
  const rootTasks = getRootTasks(def.tasks);
  const steps = rootTasks.map((task) => convertTaskToNode(task, taskMap));

  return { trigger, steps };
}

/** Finds the step matching `id` anywhere in the tree (including nested condition branches). */
export function findStepInTree(steps: StepNode[], id: string): StepNode | undefined {
  for (const step of steps) {
    if (step.id === id) {
      return step;
    }
    if (step.type === "condition") {
      const found = findStepInTree(step.thenBranch, id) ?? findStepInTree(step.elseBranch, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/** Replaces the step matching `id` anywhere in the tree (including nested condition branches). */
export function updateStepInTree(steps: StepNode[], id: string, updater: (node: StepNode) => StepNode): StepNode[] {
  return steps.map((step) => {
    if (step.id === id) {
      return updater(step);
    }
    if (step.type === "condition") {
      return {
        ...step,
        thenBranch: updateStepInTree(step.thenBranch, id, updater),
        elseBranch: updateStepInTree(step.elseBranch, id, updater),
      };
    }
    return step;
  });
}

/** Identifies where in the tree a new step should land: the root list, or a specific condition's branch. */
export type BranchPath = { parentId: string; branch: "thenBranch" | "elseBranch" } | null;

/** Inserts `newStep` at `index` into the root list (path `null`) or the named branch of the condition matching `path.parentId`. */
export function insertStepInTree(steps: StepNode[], path: BranchPath, index: number, newStep: StepNode): StepNode[] {
  if (path === null) {
    const next = [...steps];
    next.splice(index, 0, newStep);
    return next;
  }
  return steps.map((step) => {
    if (step.type !== "condition") {
      return step;
    }
    if (step.id === path.parentId) {
      const nextBranch = [...step[path.branch]];
      nextBranch.splice(index, 0, newStep);
      return { ...step, [path.branch]: nextBranch };
    }
    return {
      ...step,
      thenBranch: insertStepInTree(step.thenBranch, path, index, newStep),
      elseBranch: insertStepInTree(step.elseBranch, path, index, newStep),
    };
  });
}

/** Removes the step matching `id` anywhere in the tree. Removing a condition also removes everything in its branches. */
export function removeStepFromTree(steps: StepNode[], id: string): StepNode[] {
  return steps
    .filter((step) => step.id !== id)
    .map((step) =>
      step.type === "condition"
        ? {
            ...step,
            thenBranch: removeStepFromTree(step.thenBranch, id),
            elseBranch: removeStepFromTree(step.elseBranch, id),
          }
        : step
    );
}

/** Total action steps anywhere in the tree, including nested condition branches — a workflow must always have at least one. */
export function countActionSteps(steps: StepNode[]): number {
  let count = 0;
  for (const step of steps) {
    if (step.type === "action") {
      count += 1;
    } else if (step.type === "condition") {
      count += countActionSteps(step.thenBranch) + countActionSteps(step.elseBranch);
    }
  }
  return count;
}

function convertNodeToTask(node: StepNode): TaskDefinition {
  if (node.type === "action") {
    const task: TaskWithRef = {
      id: node.id,
      type: "action",
      action: node.action,
      parameters: node.parameters,
    };
    if (node.ref) {
      task.$ref = node.ref;
    }
    if (node.function) {
      task.function = node.function;
    }
    return task;
  }

  if (node.type === "condition") {
    const tasks: TaskDefinition[] = [
      {
        id: node.id,
        type: "condition",
        conditions: node.conditions,
        onTrue: node.thenBranch.map((child) => child.id),
        onFalse: node.elseBranch.map((child) => child.id),
      },
    ];

    for (const child of node.thenBranch) {
      tasks.push(convertNodeToTask(child));
    }

    for (const child of node.elseBranch) {
      tasks.push(convertNodeToTask(child));
    }

    return tasks[0];
  }

  return {
    id: node.id,
    type: "wait",
    wait: node.wait,
  };
}

/**
 * Flattens the tree into the engine's flat `tasks[]`, assigning `dependsOn` as it goes so
 * execution order matches the tree's visual structure. This matters because the engine's
 * execution order is a topological sort over `dependsOn` edges ONLY — `onTrue`/`onFalse`
 * mark which branch to skip but establish no ordering by themselves
 * (workflow/internal/engine/executor.go's NewDependencyGraph never reads them). Without an
 * explicit `dependsOn`, a task floats as an unordered "root" alongside every other
 * dependsOn-less task — nondeterministic relative to whatever it visually follows.
 *
 * `parentId` is what the first item in `steps` should depend on: undefined for the root
 * list (no dependency), or the owning condition's id when flattening a thenBranch/elseBranch
 * (so a branch's first child depends on the condition, not on whatever the *other* branch's
 * last task happened to be). Every later item in the same list depends on its immediate
 * predecessor in that same list — a step following a condition block depends on the
 * condition itself, since only one of its two branches actually runs.
 */
function flattenSteps(steps: StepNode[], parentId?: string): TaskDefinition[] {
  const tasks: TaskDefinition[] = [];
  let prevId = parentId;

  for (const step of steps) {
    const task = convertNodeToTask(step);
    if (prevId !== undefined) {
      task.dependsOn = [prevId];
    }
    tasks.push(task);
    prevId = step.id;

    if (step.type === "condition") {
      tasks.push(...flattenSteps(step.thenBranch, step.id));
      tasks.push(...flattenSteps(step.elseBranch, step.id));
    }
  }

  return tasks;
}

export function treeToDefinition(tree: WorkflowTree): WorkflowDefinition {
  const tasks = flattenSteps(tree.steps);

  const trigger: TriggerBlockWithRef = {
    type: "event",
    event: tree.trigger.event,
    conditions: tree.trigger.conditions,
  };
  if (tree.trigger.ref) {
    trigger.$ref = tree.trigger.ref;
  }

  return {
    id: "",
    name: "",
    trigger,
    tasks,
  };
}
