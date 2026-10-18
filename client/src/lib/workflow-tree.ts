import type { ConditionConfig, TaskDefinition, WorkflowDefinition } from "@woofx3/api";
import type { Duration, SubWorkflowConfig } from "@woofx3/api/workflow-definition";
import type { WaitConfig } from "./wait-config";

/**
 * The editor's model of a workflow: the trigger, then a list of steps in the order they run,
 * with each condition holding the steps of its two branches.
 *
 * The engine stores a flat `tasks[]` ordered by `dependsOn` and branched by a condition's
 * `onTrue`/`onFalse`. `definitionToTree` reads a definition into a tree only when
 * `treeToDefinition` writes that tree back as the same definition, so saving a workflow changes
 * only what was edited in it. Every task field is carried: the ones the editor uses are typed on
 * the node, and the rest ride along in `extra`.
 */
export interface WorkflowTree {
  /** The definition's fields besides `trigger` and `tasks` (id, name, description, options, ...), as read. */
  workflow?: Record<string, unknown>;
  /** How `treeToDefinition` writes order and branches. A tree the editor builds from nothing uses "nested". */
  layout?: TreeLayout;
  trigger: TriggerNode;
  steps: StepNode[];
}

/**
 * The encodings of a tree in `dependsOn` and `onTrue`/`onFalse` that definitions in the wild use.
 * A tree is written back in the layout it was read in, so an edit changes only the edited steps.
 *
 * - `nested`: each step list is its own chain. A list's first step depends on the condition that
 *   owns it (nothing, for the top list), every later step on the one before it, and a condition
 *   lists only its direct children. This is what the editor writes.
 * - `chained`: one chain through every step in reading order, and a condition lists every step
 *   inside it, nested ones included. Setup import (`convex/lib/setupImport/compile.ts`) writes this.
 * - `listed`: steps inside a branch have no `dependsOn`; every other step depends on the task
 *   written before it, and a condition lists only its direct children. Definitions saved by
 *   earlier versions of this editor use it.
 */
export type TreeLayout = "nested" | "chained" | "listed";

const LAYOUTS: readonly TreeLayout[] = ["nested", "chained", "listed"];

/**
 * How a definition wrote a field that the tree holds as a default value (an empty list, an empty
 * string, ...): left out, `null`, or the default value itself. Kept so the field saves back the
 * way it was read for as long as it still holds that default.
 */
export type EmptyForm = "absent" | "null" | "empty";

type EmptyForms = Partial<Record<string, EmptyForm>>;

export interface TriggerNode {
  type: "trigger";
  id: string;
  /** The trigger block's `type`: "event" or "schedule". Undefined reads as "event". */
  triggerType?: string;
  event: string;
  /** Cron expression of a schedule trigger. */
  schedule?: string;
  conditions: ConditionConfig[];
  /** Canonical catalog ref (e.g. `twitch_platform:trigger:redeem.channelpoints`), when set at creation time. */
  ref?: string;
  /** Trigger fields this model does not name, written back as read. */
  extra?: Record<string, unknown>;
  emptyAs?: EmptyForms;
}

export type StepNode = ActionNode | ConditionNode | WaitNode | LogNode | SubWorkflowNode | UnknownNode;

/** Task fields every engine task type accepts. */
interface StepFields {
  id: string;
  /** Skips the step. A disabled condition settles as false without evaluating. */
  disabled?: boolean;
  onError?: "fail" | "continue";
  timeout?: Duration;
  /** Names for values of the step's result that later steps read as `${id.name}`. */
  exports?: Record<string, string>;
  /** On a condition, one more condition it evaluates; on any other step, a guard that skips it when false. */
  condition?: ConditionConfig;
  conditionLogic?: "and" | "or";
  /** Task fields this model does not name, written back as read. */
  extra?: Record<string, unknown>;
  emptyAs?: EmptyForms;
}

/** Fields of a step that is not a condition, whose `conditions` guard it rather than branch. */
interface GuardedStepFields extends StepFields {
  /** Guards: the step is skipped unless they hold, combined by `conditionLogic`. */
  conditions?: ConditionConfig[];
}

export interface ActionNode extends GuardedStepFields {
  type: "action";
  action: string;
  parameters: Record<string, unknown>;
  /** Canonical catalog ref, when set at creation time. */
  ref?: string;
  /** Specific registered function/handler call name, for `action: "function"` tasks. */
  function?: string;
}

export interface ConditionNode extends StepFields {
  type: "condition";
  conditions: ConditionConfig[];
  thenBranch: StepNode[];
  elseBranch: StepNode[];
}

export interface WaitNode extends GuardedStepFields {
  type: "wait";
  wait: WaitConfig;
}

/** The engine's `log` task: writes `parameters.message` to the engine log. */
export interface LogNode extends GuardedStepFields {
  type: "log";
  parameters?: Record<string, unknown>;
}

/** The engine's `workflow` task: runs another workflow. */
export interface SubWorkflowNode extends GuardedStepFields {
  type: "workflow";
  workflow?: SubWorkflowConfig;
}

/** A task of a type the editor does not know, kept whole in `extra` (everything but id, type and dependsOn). */
export interface UnknownNode {
  type: "unknown";
  id: string;
  taskType: string;
  extra?: Record<string, unknown>;
  emptyAs?: EmptyForms;
}

/** Why a definition could not be read as a tree. */
export type TreeShapeProblem =
  | { kind: "malformed"; detail: string }
  | { kind: "duplicate-task-id"; taskId: string }
  | { kind: "unknown-task-reference"; taskId: string; field: "dependsOn" | "onTrue" | "onFalse"; reference: string }
  | { kind: "joined-step"; taskId: string }
  | { kind: "dependency-cycle"; taskId: string }
  | { kind: "shared-branch-step"; taskId: string }
  | { kind: "branch-cycle"; taskId: string }
  | { kind: "unsequenced-step"; taskId: string };

export type DefinitionToTreeResult =
  | { editable: true; tree: WorkflowTree }
  | { editable: false; problem: TreeShapeProblem; message: string };

export function describeTreeShapeProblem(problem: TreeShapeProblem): string {
  switch (problem.kind) {
    case "malformed":
      return `This workflow can't be read as a list of steps: ${problem.detail}.`;
    case "duplicate-task-id":
      return `Two steps share the id "${problem.taskId}".`;
    case "unknown-task-reference":
      return `Step "${problem.taskId}" names a step "${problem.reference}" in its ${problem.field} that doesn't exist.`;
    case "joined-step":
      return `Step "${problem.taskId}" waits for more than one step, so steps run side by side, which the editor can't show yet.`;
    case "dependency-cycle":
      return `Step "${problem.taskId}" is part of a loop of steps that wait for each other.`;
    case "shared-branch-step":
      return `Step "${problem.taskId}" belongs to more than one branch.`;
    case "branch-cycle":
      return `Step "${problem.taskId}" is inside its own branch.`;
    case "unsequenced-step":
      return `Step "${problem.taskId}" runs in an order the editor can't show as a list.`;
  }
}

const TRIGGER_NODE_ID = "__trigger";

const DEFAULT_WAIT: WaitConfig = { type: "event", event: "" };

const STRUCTURAL_FIELDS = ["id", "type", "dependsOn"] as const;
const COMMON_FIELDS = ["disabled", "onError", "timeout", "exports", "condition", "conditionLogic"] as const;
const GUARDED_FIELDS = [...COMMON_FIELDS, "conditions"] as const;

/** Task fields each node kind models; anything else on the task goes to `extra`. */
const MODELLED_FIELDS: Record<StepNode["type"], readonly string[]> = {
  action: [...STRUCTURAL_FIELDS, ...GUARDED_FIELDS, "action", "parameters", "$ref", "function"],
  condition: [...STRUCTURAL_FIELDS, ...COMMON_FIELDS, "conditions", "onTrue", "onFalse"],
  wait: [...STRUCTURAL_FIELDS, ...GUARDED_FIELDS, "wait"],
  log: [...STRUCTURAL_FIELDS, ...GUARDED_FIELDS, "parameters"],
  workflow: [...STRUCTURAL_FIELDS, ...GUARDED_FIELDS, "workflow"],
  unknown: STRUCTURAL_FIELDS,
};

const TRIGGER_FIELDS = ["type", "event", "schedule", "conditions", "$ref"];

type Raw = Record<string, unknown>;

function isPlainObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality over JSON values, where a key holding `undefined` counts as absent. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return false;
  }
  const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
  const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => key in b && jsonEqual(a[key], b[key]));
}

/** Reads `key`, standing in `fallback` for a missing or null value and noting how the source wrote it. */
function readDefaulted<T>(raw: Raw, key: string, fallback: T, emptyAs: EmptyForms): T {
  const value = raw[key];
  if (value === undefined) {
    emptyAs[key] = "absent";
    return fallback;
  }
  if (value === null) {
    emptyAs[key] = "null";
    return fallback;
  }
  if (jsonEqual(value, fallback)) {
    emptyAs[key] = "empty";
  }
  return value as T;
}

/**
 * Writes `key`. While it holds `fallback` it is written the way the source wrote it, or as
 * `newForm` for a node the editor created.
 */
function writeDefaulted(
  out: Raw,
  key: string,
  value: unknown,
  fallback: unknown,
  emptyAs: EmptyForms | undefined,
  newForm: EmptyForm
): void {
  if (!jsonEqual(value, fallback)) {
    out[key] = value;
    return;
  }
  const form = emptyAs?.[key] ?? newForm;
  if (form === "null") {
    out[key] = null;
  } else if (form === "empty") {
    out[key] = value;
  }
}

function copyDefined(from: Raw, to: Raw, keys: readonly string[]): void {
  for (const key of keys) {
    if (from[key] !== undefined) {
      to[key] = from[key];
    }
  }
}

function unmodelledFields(raw: Raw, modelled: readonly string[]): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && !modelled.includes(key)) {
      extra[key] = value;
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function withOptional<T extends { extra?: Record<string, unknown>; emptyAs?: EmptyForms }>(
  node: T,
  extra: Record<string, unknown> | undefined,
  emptyAs: EmptyForms
): T {
  const out: T = { ...node };
  if (extra) {
    out.extra = extra;
  }
  if (Object.keys(emptyAs).length > 0) {
    out.emptyAs = emptyAs;
  }
  return out;
}

function readTrigger(block: Raw): TriggerNode {
  const emptyAs: EmptyForms = {};
  const node: TriggerNode = {
    type: "trigger",
    id: TRIGGER_NODE_ID,
    triggerType: readDefaulted(block, "type", "event", emptyAs),
    event: readDefaulted(block, "event", "", emptyAs),
    conditions: readDefaulted<ConditionConfig[]>(block, "conditions", [], emptyAs),
  };
  if (block.schedule !== undefined) {
    node.schedule = block.schedule as string;
  }
  if (block.$ref !== undefined) {
    node.ref = block.$ref as string;
  }
  return withOptional(node, unmodelledFields(block, TRIGGER_FIELDS), emptyAs);
}

function writeTrigger(node: TriggerNode): WorkflowDefinition["trigger"] {
  const out: Raw = { ...node.extra };
  writeDefaulted(out, "type", node.triggerType ?? "event", "event", node.emptyAs, "empty");
  writeDefaulted(out, "event", node.event, "", node.emptyAs, "empty");
  if (node.schedule !== undefined) {
    out.schedule = node.schedule;
  }
  writeDefaulted(out, "conditions", node.conditions, [], node.emptyAs, "empty");
  if (node.ref !== undefined) {
    out.$ref = node.ref;
  }
  return out as unknown as WorkflowDefinition["trigger"];
}

function stepKind(taskType: unknown): StepNode["type"] {
  switch (taskType) {
    case "action":
    case "condition":
    case "wait":
    case "log":
    case "workflow":
      return taskType;
    default:
      return "unknown";
  }
}

function readStep(raw: Raw, branch: (side: BranchSide) => StepNode[]): StepNode {
  const id = raw.id as string;
  const kind = stepKind(raw.type);
  const emptyAs: EmptyForms = {};
  readDefaulted<string[]>(raw, "dependsOn", [], emptyAs);
  const extra = unmodelledFields(raw, MODELLED_FIELDS[kind]);
  const fields: Raw = {};
  copyDefined(raw, fields, kind === "condition" ? COMMON_FIELDS : GUARDED_FIELDS);

  switch (kind) {
    case "action": {
      const node: Raw = {
        type: "action",
        id,
        ...fields,
        action: readDefaulted(raw, "action", "", emptyAs),
        parameters: readDefaulted(raw, "parameters", {}, emptyAs),
      };
      if (raw.$ref !== undefined) {
        node.ref = raw.$ref;
      }
      if (raw.function !== undefined) {
        node.function = raw.function;
      }
      return withOptional(node as unknown as ActionNode, extra, emptyAs);
    }
    case "condition": {
      const node: ConditionNode = {
        type: "condition",
        id,
        ...fields,
        conditions: readDefaulted<ConditionConfig[]>(raw, "conditions", [], emptyAs),
        thenBranch: branch("onTrue"),
        elseBranch: branch("onFalse"),
      };
      readDefaulted(raw, "onTrue", [], emptyAs);
      readDefaulted(raw, "onFalse", [], emptyAs);
      return withOptional(node, extra, emptyAs);
    }
    case "wait": {
      const node: WaitNode = { type: "wait", id, ...fields, wait: readDefaulted(raw, "wait", DEFAULT_WAIT, emptyAs) };
      return withOptional(node, extra, emptyAs);
    }
    case "log": {
      const node: Raw = { type: "log", id, ...fields };
      copyDefined(raw, node, ["parameters"]);
      return withOptional(node as unknown as LogNode, extra, emptyAs);
    }
    case "workflow": {
      const node: Raw = { type: "workflow", id, ...fields };
      copyDefined(raw, node, ["workflow"]);
      return withOptional(node as unknown as SubWorkflowNode, extra, emptyAs);
    }
    case "unknown": {
      const node: UnknownNode = { type: "unknown", id, taskType: String(raw.type) };
      return withOptional(node, extra, emptyAs);
    }
  }
}

/** The task for `node`, with `dependsOn` but without a condition's `onTrue`/`onFalse` (see writeBranches). */
function writeStep(node: StepNode, dependsOn: string[]): TaskDefinition {
  const out: Raw = { ...node.extra, id: node.id, type: node.type === "unknown" ? node.taskType : node.type };
  writeDefaulted(out, "dependsOn", dependsOn, [], node.emptyAs, "absent");
  if (node.type === "unknown") {
    return out as unknown as TaskDefinition;
  }
  const fields = node as unknown as Raw;
  copyDefined(fields, out, node.type === "condition" ? COMMON_FIELDS : GUARDED_FIELDS);

  switch (node.type) {
    case "action":
      writeDefaulted(out, "action", node.action, "", node.emptyAs, "empty");
      writeDefaulted(out, "parameters", node.parameters, {}, node.emptyAs, "empty");
      if (node.ref !== undefined) {
        out.$ref = node.ref;
      }
      if (node.function !== undefined) {
        out.function = node.function;
      }
      break;
    case "condition":
      writeDefaulted(out, "conditions", node.conditions, [], node.emptyAs, "empty");
      break;
    case "wait":
      writeDefaulted(out, "wait", node.wait, DEFAULT_WAIT, node.emptyAs, "empty");
      break;
    case "log":
      copyDefined(fields, out, ["parameters"]);
      break;
    case "workflow":
      copyDefined(fields, out, ["workflow"]);
      break;
  }
  return out as unknown as TaskDefinition;
}

function writeBranches(task: TaskDefinition, node: ConditionNode, onTrue: string[], onFalse: string[]): void {
  writeDefaulted(task as unknown as Raw, "onTrue", onTrue, [], node.emptyAs, "empty");
  writeDefaulted(task as unknown as Raw, "onFalse", onFalse, [], node.emptyAs, "empty");
}

/**
 * The `nested` layout. The engine runs a task after everything in its `dependsOn`, and a task a
 * condition lists in `onTrue`/`onFalse` after that condition; the branch not taken is skipped,
 * along with every condition nested in it. A task that depends on a condition waits for the whole
 * branch that ran, and tasks that wait on nothing run in `tasks` order. Each step still gets an
 * explicit dependency, so the order holds on an engine that orders by `dependsOn` alone: a list's
 * first step on the condition that owns it, or none at the top; every later step on the step
 * before it in its own list. A step after a condition depends on the condition.
 */
function flattenNested(steps: StepNode[], parentId?: string): TaskDefinition[] {
  const tasks: TaskDefinition[] = [];
  let prevId = parentId;
  for (const step of steps) {
    const task = writeStep(step, prevId === undefined ? [] : [prevId]);
    tasks.push(task);
    prevId = step.id;
    if (step.type === "condition") {
      writeBranches(
        task,
        step,
        step.thenBranch.map((child) => child.id),
        step.elseBranch.map((child) => child.id)
      );
      tasks.push(...flattenNested(step.thenBranch, step.id));
      tasks.push(...flattenNested(step.elseBranch, step.id));
    }
  }
  return tasks;
}

/** The `chained` layout: each task depends on the one written before it, and a condition lists every task under it. */
function flattenChained(steps: StepNode[], tasks: TaskDefinition[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    const previous = tasks.at(-1);
    const task = writeStep(step, previous ? [previous.id] : []);
    tasks.push(task);
    ids.push(step.id);
    if (step.type === "condition") {
      const onTrue = flattenChained(step.thenBranch, tasks);
      const onFalse = flattenChained(step.elseBranch, tasks);
      writeBranches(task, step, onTrue, onFalse);
      ids.push(...onTrue, ...onFalse);
    }
  }
  return ids;
}

/** The `listed` layout: branch steps have no dependency; every other task depends on the one written before it. */
function flattenListed(steps: StepNode[], tasks: TaskDefinition[], inBranch: boolean): void {
  for (const step of steps) {
    const previous = tasks.at(-1);
    const task = writeStep(step, !inBranch && previous ? [previous.id] : []);
    tasks.push(task);
    if (step.type === "condition") {
      writeBranches(
        task,
        step,
        step.thenBranch.map((child) => child.id),
        step.elseBranch.map((child) => child.id)
      );
      flattenListed(step.thenBranch, tasks, true);
      flattenListed(step.elseBranch, tasks, true);
    }
  }
}

function flattenTree(steps: StepNode[], layout: TreeLayout): TaskDefinition[] {
  if (layout === "nested") {
    return flattenNested(steps);
  }
  const tasks: TaskDefinition[] = [];
  if (layout === "chained") {
    flattenChained(steps, tasks);
  } else {
    flattenListed(steps, tasks, false);
  }
  return tasks;
}

/** Writes tasks in reading order: each step, then its condition's then-branch, then its else-branch. */
export function treeToDefinition(tree: WorkflowTree): WorkflowDefinition {
  return {
    ...(tree.workflow ?? { id: "", name: "" }),
    trigger: writeTrigger(tree.trigger),
    tasks: flattenTree(tree.steps, tree.layout ?? "nested"),
  } as WorkflowDefinition;
}

type BranchSide = "onTrue" | "onFalse";

interface Placement {
  parentId: string;
  side: BranchSide;
}

type Checked<T> = { ok: true; value: T } | { ok: false; problem: TreeShapeProblem };

function listField(raw: Raw, key: string): string[] | null {
  const value = raw[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return value;
}

/** Checks ids and references, and that each task depends on at most one other. */
function checkReferences(tasks: Raw[]): TreeShapeProblem | null {
  const ids = new Set<string>();
  for (const [index, task] of tasks.entries()) {
    if (typeof task.id !== "string" || task.id === "") {
      return { kind: "malformed", detail: `task ${index + 1} has no id` };
    }
    if (ids.has(task.id)) {
      return { kind: "duplicate-task-id", taskId: task.id };
    }
    ids.add(task.id);
  }
  for (const task of tasks) {
    const taskId = task.id as string;
    const fields: ("dependsOn" | BranchSide)[] =
      task.type === "condition" ? ["dependsOn", "onTrue", "onFalse"] : ["dependsOn"];
    for (const field of fields) {
      const refs = listField(task, field);
      if (refs === null) {
        return { kind: "malformed", detail: `step "${taskId}" has a ${field} that isn't a list of step ids` };
      }
      for (const reference of refs) {
        if (!ids.has(reference)) {
          return { kind: "unknown-task-reference", taskId, field, reference };
        }
        if (reference === taskId) {
          return field === "dependsOn" ? { kind: "dependency-cycle", taskId } : { kind: "branch-cycle", taskId };
        }
      }
    }
    if ((listField(task, "dependsOn") ?? []).length > 1) {
      return { kind: "joined-step", taskId };
    }
  }
  return null;
}

/**
 * Each task's position in run order: a topological order over `dependsOn`, ties broken by array
 * position. Every task depends on at most one other here (checkReferences).
 */
function runOrder(tasks: Raw[]): Checked<Map<string, number>> {
  const position = new Map<string, number>();
  while (position.size < tasks.length) {
    const next = tasks.find((task) => {
      if (position.has(task.id as string)) {
        return false;
      }
      return (listField(task, "dependsOn") ?? []).every((dep) => position.has(dep));
    });
    if (!next) {
      const stuck = tasks.find((task) => !position.has(task.id as string));
      return { ok: false, problem: { kind: "dependency-cycle", taskId: stuck?.id as string } };
    }
    position.set(next.id as string, position.size);
  }
  return { ok: true, value: position };
}

/**
 * Which condition branch each task sits in directly. A condition may list only its direct
 * children (nested, listed) or every task under it (chained), so a task's parent is the one
 * condition listing it that every other condition listing it also lists.
 */
function placeInBranches(tasks: Raw[]): Checked<Map<string, Placement>> {
  const listedBy = new Map<string, Map<string, BranchSide>>();
  for (const task of tasks) {
    if (task.type !== "condition") {
      continue;
    }
    for (const side of ["onTrue", "onFalse"] as const) {
      for (const childId of listField(task, side) ?? []) {
        const owners = listedBy.get(childId) ?? new Map<string, BranchSide>();
        const existing = owners.get(task.id as string);
        if (existing !== undefined && existing !== side) {
          return { ok: false, problem: { kind: "shared-branch-step", taskId: childId } };
        }
        owners.set(task.id as string, side);
        listedBy.set(childId, owners);
      }
    }
  }

  const placement = new Map<string, Placement>();
  for (const [taskId, owners] of listedBy) {
    const ownerIds = [...owners.keys()];
    const parents = ownerIds.filter((candidate) =>
      ownerIds.every((other) => other === candidate || (listedBy.get(candidate)?.has(other) ?? false))
    );
    if (parents.length !== 1) {
      return { ok: false, problem: { kind: "shared-branch-step", taskId } };
    }
    const parentId = parents[0];
    placement.set(taskId, { parentId, side: owners.get(parentId) as BranchSide });
  }

  for (const taskId of placement.keys()) {
    const seen = new Set<string>([taskId]);
    let current = placement.get(taskId);
    while (current) {
      if (seen.has(current.parentId)) {
        return { ok: false, problem: { kind: "branch-cycle", taskId } };
      }
      seen.add(current.parentId);
      current = placement.get(current.parentId);
    }
  }
  return { ok: true, value: placement };
}

function tasksById(tasks: readonly TaskDefinition[]): Map<string, TaskDefinition> {
  return new Map(tasks.map((task) => [task.id, task]));
}

/**
 * Whether `written` is `source`, ignoring the order of `tasks`. Tasks are written in reading
 * order, which is the order the source runs them in, so tasks that wait on nothing keep their
 * relative order.
 */
function sameDefinition(written: WorkflowDefinition, source: WorkflowDefinition): boolean {
  const { tasks: writtenTasks, ...writtenRest } = written;
  const { tasks: sourceTasks, ...sourceRest } = source;
  if (!jsonEqual(writtenRest, sourceRest) || writtenTasks.length !== sourceTasks.length) {
    return false;
  }
  const byId = tasksById(writtenTasks);
  return sourceTasks.every((task) => jsonEqual(byId.get(task.id), task));
}

function notATree(problem: TreeShapeProblem): DefinitionToTreeResult {
  return { editable: false, problem, message: describeTreeShapeProblem(problem) };
}

/**
 * Reads a definition into a tree, or says why it can't be one. A tree is returned only when
 * `treeToDefinition` writes it back as `def`, apart from the order of `tasks`, which is
 * written in reading order.
 */
export function definitionToTree(def: WorkflowDefinition): DefinitionToTreeResult {
  const raw = def as unknown as Raw;
  if (!isPlainObject(raw.trigger)) {
    return notATree({ kind: "malformed", detail: "it has no trigger" });
  }
  if (!Array.isArray(raw.tasks) || !raw.tasks.every(isPlainObject)) {
    return notATree({ kind: "malformed", detail: "its tasks aren't a list of steps" });
  }
  const tasks = raw.tasks as Raw[];

  const referenceProblem = checkReferences(tasks);
  if (referenceProblem) {
    return notATree(referenceProblem);
  }
  const order = runOrder(tasks);
  if (!order.ok) {
    return notATree(order.problem);
  }
  const placement = placeInBranches(tasks);
  if (!placement.ok) {
    return notATree(placement.problem);
  }

  const groups = new Map<string, Raw[]>();
  const groupKey = (parentId: string | undefined, side?: BranchSide) =>
    parentId === undefined ? "" : `${parentId}\u0000${side}`;
  const inRunOrder = [...tasks].sort(
    (a, b) => (order.value.get(a.id as string) as number) - (order.value.get(b.id as string) as number)
  );
  for (const task of inRunOrder) {
    const place = placement.value.get(task.id as string);
    const key = groupKey(place?.parentId, place?.side);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const readList = (key: string): StepNode[] =>
    (groups.get(key) ?? []).map((task) => readStep(task, (side) => readList(groupKey(task.id as string, side))));

  const { trigger, tasks: _tasks, ...workflow } = raw;
  const tree: WorkflowTree = {
    workflow,
    trigger: readTrigger(trigger as Raw),
    steps: readList(groupKey(undefined)),
  };

  for (const layout of LAYOUTS) {
    const candidate = { ...tree, layout };
    if (sameDefinition(treeToDefinition(candidate), def)) {
      return { editable: true, tree: candidate };
    }
  }

  const written = tasksById(treeToDefinition({ ...tree, layout: "nested" }).tasks);
  const mismatch = def.tasks.find((task) => !jsonEqual(written.get(task.id), task));
  return notATree(
    mismatch
      ? { kind: "unsequenced-step", taskId: mismatch.id }
      : { kind: "malformed", detail: "it would not save back unchanged" }
  );
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

/** Whether the editor has controls for this kind of step. Others show as rows that can't be edited. */
export function isEditableStep(node: StepNode): node is ActionNode | ConditionNode | WaitNode {
  return node.type === "action" || node.type === "condition" || node.type === "wait";
}

/** A short name for a step's kind, for headings and rows. */
export function stepKindLabel(node: StepNode): string {
  switch (node.type) {
    case "action":
      return "Action";
    case "condition":
      return "Condition";
    case "wait":
      return "Wait";
    case "log":
      return "Log";
    case "workflow":
      return "Run workflow";
    case "unknown":
      return `Unsupported step (${node.taskType})`;
  }
}
