import type { Doc } from "@convex/_generated/dataModel";
import type { ConditionConfig, WorkflowDefinition } from "@woofx3/api";
import type { TaskDefinition } from "@woofx3/api/workflow-definition";
import { unescapeDollarKeys } from "@/lib/dollar-keys";
import type { TriggerConfigValues } from "@/lib/workflow-presets";

/**
 * Projects one engine workflow into the shape the triggers UI edits, and back.
 *
 * The engine is the source of truth and knows nothing about "triggers" or "alerts":
 * one workflow serves one event, each configured trigger is a `condition` task, and
 * that trigger's actions are the tasks it names in `onTrue`. Everything here is
 * derived from the definition, so a workflow edited in the builder reads back
 * correctly and one edited here stays an ordinary workflow.
 *
 * Three engine behaviours shape the encoding, all verified in
 * `workflow/internal/engine/engine.go`:
 *
 *  - **Skipping is not transitive.** A task depending on a skipped task still runs, so
 *    every action of a trigger is listed in its `onTrue`, not just the first.
 *  - **Skip marks are sticky.** A condition marks its not-taken branch skipped for the
 *    whole run, so an action listed in two triggers' `onTrue` dies whenever either
 *    misses. Shared actions therefore hang off a guard instead — condition tasks
 *    export `result`, and a guard reading `${rule_1.result}` sees it.
 *  - **Execution is sequential.** `dependsOn` orders tasks; it never runs them at once
 *    (see woofx3#66). Actions the user marks concurrent share a `dependsOn` set, which
 *    is the correct DAG regardless, and start behaving that way when the engine does.
 */

/** One action inside a trigger, or a shared one. */
export interface ProjectedAction {
  /** Task id. Stable across saves so guards referencing it keep resolving. */
  id: string;
  /** `action` on the task — the handler type, e.g. `function`. */
  handlerType: string;
  /** Specific registered call for `function` handlers. */
  functionCall?: string;
  parameters: TriggerConfigValues;
  /** Runs at the same time as the action before it rather than after it. */
  concurrentWithPrevious: boolean;
}

/** A configured trigger: when it fires, and what it does. */
export interface ProjectedTrigger {
  /** Condition task id, or a synthetic id for the unconditional trigger. */
  id: string;
  /** Empty means it fires every time — encoded with no condition task at all. */
  conditions: ConditionConfig[];
  conditionLogic?: "and" | "or";
  actions: ProjectedAction[];
}

/** An action shared by two or more triggers. Runs once, when any of them matches. */
export interface ProjectedSharedAction extends ProjectedAction {
  triggerIds: string[];
}

export interface WorkflowProjection {
  engineWorkflowId: string;
  name: string;
  event: string;
  isEnabled: boolean;
  triggers: ProjectedTrigger[];
  shared: ProjectedSharedAction[];
}

/** Why a workflow can't be edited here — shown as a link to the builder instead. */
export type ProjectionFailure = { reason: string };

export type ProjectionResult = { ok: true; projection: WorkflowProjection } | { ok: false; failure: ProjectionFailure };

/** Task id of the implicit trigger holding actions that run on every event. */
export const UNCONDITIONAL_TRIGGER_ID = "__always";

type EngineTask = TaskDefinition & { function?: string; $ref?: string };

const RESULT_REFERENCE = /^\$\{([A-Za-z0-9_-]+)\.result\}$/;

export function projectWorkflow(row: Doc<"workflows">): ProjectionResult {
  const definition = unescapeDollarKeys(row.definition) as WorkflowDefinition | undefined;
  const trigger = definition?.trigger;
  if (!definition || !trigger) {
    return { ok: false, failure: { reason: "This workflow has no definition." } };
  }
  if (trigger.type !== "event") {
    return { ok: false, failure: { reason: "Only event-triggered workflows appear here." } };
  }
  if ((trigger.conditions ?? []).length > 0) {
    // Conditions on the trigger gate every task, which is not something this screen
    // can express — it puts each trigger's conditions on its own condition task.
    return { ok: false, failure: { reason: "Its conditions are on the trigger itself, gating the whole workflow." } };
  }

  const tasks = (definition.tasks ?? []) as EngineTask[];
  const unsupported = tasks.find((task) => task.type !== "action" && task.type !== "condition");
  if (unsupported) {
    return { ok: false, failure: { reason: `It uses a ${unsupported.type} step.` } };
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const conditionTasks = tasks.filter((task) => task.type === "condition");

  const withOnFalse = conditionTasks.find((task) => (task.onFalse ?? []).length > 0);
  if (withOnFalse) {
    return { ok: false, failure: { reason: "It uses an else branch." } };
  }

  const claimed = new Set<string>();
  const triggers: ProjectedTrigger[] = [];

  for (const task of conditionTasks) {
    const actionIds = task.onTrue ?? [];
    const actions: ProjectedAction[] = [];
    for (const actionId of actionIds) {
      const actionTask = byId.get(actionId);
      if (!actionTask || actionTask.type !== "action") {
        return { ok: false, failure: { reason: `Step "${actionId}" is missing or is not an action.` } };
      }
      if (claimed.has(actionId)) {
        // Listed by two conditions — the engine skips it whenever either misses, so it
        // does not do what the workflow appears to say. Shared actions use a guard.
        return { ok: false, failure: { reason: `Step "${actionId}" is claimed by more than one condition.` } };
      }
      const previousTask = actionIds[actions.length - 1] ? byId.get(actionIds[actions.length - 1]) : undefined;
      claimed.add(actionId);
      actions.push(toProjectedAction(actionTask, previousTask));
    }
    claimed.add(task.id);
    triggers.push({
      id: task.id,
      conditions: normalizeConditions(task),
      conditionLogic: task.conditionLogic,
      actions,
    });
  }

  const shared: ProjectedSharedAction[] = [];
  const loose: EngineTask[] = [];

  for (const task of tasks) {
    if (claimed.has(task.id) || task.type !== "action") {
      continue;
    }
    const triggerIds = guardedTriggerIds(task);
    if (triggerIds.length > 0) {
      const known = triggerIds.every((id) => triggers.some((t) => t.id === id));
      if (!known) {
        return { ok: false, failure: { reason: `Step "${task.id}" guards on a step that isn't a trigger here.` } };
      }
      shared.push({ ...toProjectedAction(task, undefined), triggerIds });
      continue;
    }
    if ((task.conditions ?? []).length > 0 || task.condition) {
      return { ok: false, failure: { reason: `Step "${task.id}" has conditions this screen can't show.` } };
    }
    loose.push(task);
  }

  // Actions belonging to no condition run on every event — the shape a plain
  // single-step workflow already has, which is why those project without migration.
  if (loose.length > 0) {
    const actions: ProjectedAction[] = [];
    loose.forEach((task, index) => {
      actions.push(toProjectedAction(task, index > 0 ? loose[index - 1] : undefined));
    });
    triggers.unshift({ id: UNCONDITIONAL_TRIGGER_ID, conditions: [], actions });
  }

  return {
    ok: true,
    projection: {
      engineWorkflowId: row.engineWorkflowId,
      name: definition.name || row.engineWorkflowId,
      event: trigger.event,
      isEnabled: row.isEnabled,
      triggers,
      shared,
    },
  };
}

function normalizeConditions(task: EngineTask): ConditionConfig[] {
  if ((task.conditions ?? []).length > 0) {
    return task.conditions ?? [];
  }
  return task.condition ? [task.condition] : [];
}

function toProjectedAction(task: EngineTask, previous: EngineTask | undefined): ProjectedAction {
  return {
    id: task.id,
    handlerType: task.action ?? "function",
    functionCall: task.function,
    parameters: (task.parameters ?? {}) as TriggerConfigValues,
    // Same dependencies as the action before it means the two form one stage.
    concurrentWithPrevious: previous !== undefined && sameDeps(task.dependsOn, previous.dependsOn),
  };
}

function sameDeps(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

/** Trigger ids a shared action's guard names, or [] when it isn't a shared guard. */
function guardedTriggerIds(task: EngineTask): string[] {
  const conditions = normalizeConditions(task);
  if (conditions.length === 0) {
    return [];
  }
  const ids: string[] = [];
  for (const condition of conditions) {
    const match = typeof condition.field === "string" ? RESULT_REFERENCE.exec(condition.field) : null;
    if (!match || condition.operator !== "eq" || condition.value !== true) {
      return [];
    }
    ids.push(match[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Back to a workflow definition
// ---------------------------------------------------------------------------

export interface BuildDefinitionArgs {
  event: string;
  name: string;
  description?: string;
  triggers: ProjectedTrigger[];
  shared: ProjectedSharedAction[];
  /** Set when updating — the engine requires the definition's id to match the path id. */
  engineWorkflowId?: string;
}

/**
 * Encodes the edited projection back into one workflow.
 *
 * Ids are carried through from the projection rather than regenerated, so a guard
 * naming `rule_1` keeps resolving and an unchanged trigger produces an unchanged task.
 */
export function buildWorkflowDefinition(args: BuildDefinitionArgs): Omit<WorkflowDefinition, "id"> & { id?: string } {
  const tasks: EngineTask[] = [];

  for (const trigger of args.triggers) {
    const isUnconditional = trigger.conditions.length === 0;
    const actionIds = trigger.actions.map((action) => action.id);

    if (!isUnconditional) {
      tasks.push({
        id: trigger.id,
        type: "condition",
        conditions: trigger.conditions,
        ...(trigger.conditionLogic ? { conditionLogic: trigger.conditionLogic } : {}),
        // Every action, not just the first: the engine does not propagate a skip to
        // dependents, so an unlisted action would run even when the condition missed.
        onTrue: actionIds,
      });
    }

    // Actions form stages: a concurrent action joins the stage before it, a sequential
    // one waits for every task in that stage.
    let previousStage: string[] = isUnconditional ? [] : [trigger.id];
    let currentStage: string[] = [];
    for (const action of trigger.actions) {
      if (action.concurrentWithPrevious && currentStage.length > 0) {
        tasks.push(toEngineTask(action, previousStage));
        currentStage.push(action.id);
        continue;
      }
      if (currentStage.length > 0) {
        previousStage = currentStage;
      }
      tasks.push(toEngineTask(action, previousStage));
      currentStage = [action.id];
    }
  }

  for (const action of args.shared) {
    const owning = args.triggers.filter((trigger) => action.triggerIds.includes(trigger.id));
    const conditional = owning.filter((trigger) => trigger.conditions.length > 0);
    const task = toEngineTask(
      action,
      owning.map((trigger) => trigger.id).filter((id) => id !== UNCONDITIONAL_TRIGGER_ID)
    );
    // One guard reading each owning trigger's exported result, ORed: the engine skips a
    // task listed in a missed condition's branch outright, so membership can't be used.
    // An unconditional owner always matches, which leaves the action unguarded.
    if (conditional.length === owning.length && conditional.length > 0) {
      task.conditions = conditional.map((trigger) => ({
        field: `\${${trigger.id}.result}`,
        operator: "eq" as const,
        value: true,
      }));
      task.conditionLogic = "or";
    }
    tasks.push(task);
  }

  const definition: Omit<WorkflowDefinition, "id"> & { id?: string } = {
    name: args.name,
    description: args.description,
    trigger: { type: "event", event: args.event },
    tasks: tasks as WorkflowDefinition["tasks"],
  };
  if (args.engineWorkflowId) {
    definition.id = args.engineWorkflowId;
  }
  return definition;
}

function toEngineTask(action: ProjectedAction, dependsOn: string[]): EngineTask {
  const task: EngineTask = {
    id: action.id,
    type: "action",
    action: action.handlerType,
    parameters: { ...action.parameters },
  };
  if (action.functionCall) {
    task.function = action.functionCall;
  }
  if (dependsOn.length > 0) {
    task.dependsOn = dependsOn;
  }
  return task;
}

/** Next free `prefix_N` id, so new steps never collide with ids already in the workflow. */
export function nextTaskId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  let index = 1;
  while (used.has(`${prefix}_${index}`)) {
    index += 1;
  }
  return `${prefix}_${index}`;
}
