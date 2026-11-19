import type { WorkflowDefinition } from "@woofx3/api";
import { type TriggerFields, triggerIdentity } from "./trigger-identity";

type Task = Record<string, unknown>;

/** A workflow an install may extend. Callers map their rows into this shape. */
export interface MergeWorkflowFields {
  id: string;
  isEnabled: boolean;
  /** Module-owned workflows stay separate so one module's failure can't stop another's steps. */
  managed: boolean;
  definition: WorkflowDefinition;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function taskId(task: Task): string {
  return typeof task.id === "string" ? task.id : "";
}

/**
 * The first and last tasks of the chain outside any condition's branches.
 * Undefined when there is no single place to attach more steps, mirroring
 * `topLevelEnds` in `db/app/services/workflow_merge.go`.
 */
function topLevelEnds(tasks: readonly Task[]): { first: Task; last: Task } | undefined {
  const inBranch = new Set<string>();
  for (const task of tasks) {
    for (const id of [...stringList(task.onTrue), ...stringList(task.onFalse)]) {
      inBranch.add(id);
    }
  }
  const dependedOn = new Set<string>();
  let first: Task | undefined;
  for (const task of tasks) {
    if (inBranch.has(taskId(task))) {
      continue;
    }
    const depends = stringList(task.dependsOn);
    if (depends.length > 1) {
      return undefined;
    }
    if (depends.length === 0) {
      if (first !== undefined) {
        return undefined;
      }
      first = task;
      continue;
    }
    dependedOn.add(depends[0]);
  }
  let last: Task | undefined;
  for (const task of tasks) {
    if (inBranch.has(taskId(task)) || dependedOn.has(taskId(task))) {
      continue;
    }
    if (last !== undefined) {
      return undefined;
    }
    last = task;
  }
  if (first === undefined || last === undefined) {
    return undefined;
  }
  return { first, last };
}

const EXPRESSION = /\$\{[^{}]*\}/g;

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrites step ids inside `${...}` expressions; an id after a dot is a field name. */
function renameReferences(value: unknown, renames: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(EXPRESSION, (expression) => {
      let rewritten = expression;
      for (const [from, to] of renames) {
        const pattern = new RegExp(`(^|[^.\\w-])${escapePattern(from)}($|[^\\w-])`, "g");
        rewritten = rewritten.replace(pattern, (_match, before: string, after: string) => `${before}${to}${after}`);
      }
      return rewritten;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => renameReferences(item, renames));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = renameReferences(item, renames);
    }
    return out;
  }
  return value;
}

function renameStep(task: Task, renames: ReadonlyMap<string, string>): Task {
  const out: Task = {};
  for (const [key, value] of Object.entries(task)) {
    if (key === "id") {
      continue;
    }
    if (key === "dependsOn" || key === "onTrue" || key === "onFalse") {
      out[key] = stringList(value).map((id) => renames.get(id) ?? id);
      continue;
    }
    out[key] = renameReferences(value, renames);
  }
  out.id = renames.get(taskId(task)) ?? taskId(task);
  return out;
}

/**
 * Adds `next`'s steps after `existing`'s, renaming ids that are taken and
 * rewriting everything that points at them. Throws when either list isn't one
 * chain or they export the same name, which is when the engine would leave the
 * workflows apart (`appendTasks` in `db/app/services/workflow_merge.go`).
 */
export function appendSteps(existing: readonly Task[], next: readonly Task[]): Task[] {
  const nextEnds = topLevelEnds(next);
  if (nextEnds === undefined) {
    throw new Error("The steps being installed do not read as one chain.");
  }
  let last: Task | undefined;
  if (existing.length > 0) {
    const ends = topLevelEnds(existing);
    if (ends === undefined) {
      throw new Error("The existing trigger's steps do not read as one chain.");
    }
    last = ends.last;
  }

  const taken = new Set(existing.map(taskId));
  const exported = new Set<string>();
  for (const task of existing) {
    if (task.exports !== null && typeof task.exports === "object") {
      for (const name of Object.keys(task.exports)) {
        exported.add(name);
      }
    }
  }
  for (const task of next) {
    if (task.exports !== null && typeof task.exports === "object") {
      for (const name of Object.keys(task.exports)) {
        if (exported.has(name)) {
          throw new Error(`Both triggers export "${name}".`);
        }
      }
    }
  }

  const renames = new Map<string, string>();
  for (const task of next) {
    const id = taskId(task);
    if (!taken.has(id)) {
      taken.add(id);
      continue;
    }
    let suffix = 2;
    while (taken.has(`${id}_${suffix}`)) {
      suffix += 1;
    }
    const renamed = `${id}_${suffix}`;
    renames.set(id, renamed);
    taken.add(renamed);
  }

  const renamedNext = next.map((task) => renameStep(task, renames));
  if (last !== undefined) {
    renamedNext[0].dependsOn = [taskId(last)];
  }
  return [...existing.map((task) => ({ ...task })), ...renamedNext];
}

/**
 * Barkloader names a module's workflows `{module}/{manifest name}`; those stay their own.
 * A row without a name (an older engine or a minimal list) isn't one we can name as a module.
 */
export function isModuleWorkflowName(name: string | undefined): boolean {
  return name?.includes("/") ?? false;
}

/**
 * The workflow an install extends, or undefined: the first switched-on,
 * streamer-owned workflow whose trigger identity matches and whose steps can
 * be appended to. Never picks a paused or module-owned workflow.
 */
export function findMergeTarget<T extends MergeWorkflowFields>(
  workflows: readonly T[],
  trigger: TriggerFields
): T | undefined {
  const identity = triggerIdentity(trigger);
  if (identity === undefined) {
    return undefined;
  }
  for (const workflow of workflows) {
    if (!workflow.isEnabled || workflow.managed) {
      continue;
    }
    if (triggerIdentity(workflow.definition.trigger as TriggerFields) !== identity) {
      continue;
    }
    const tasks = workflow.definition.tasks as unknown as readonly Task[] | undefined;
    if (tasks === undefined || !Array.isArray(tasks) || topLevelEnds(tasks) === undefined) {
      continue;
    }
    // A workflow holding several triggers in its steps is not one the alert UI can edit.
    if (tasks.some((task) => "trigger" in task)) {
      continue;
    }
    return workflow;
  }
  return undefined;
}
