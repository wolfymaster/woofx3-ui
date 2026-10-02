import type { ActionStep, ConditionConfig, TaskDefinition, WorkflowDefinition } from "@woofx3/api";
import { catalogAction, type StarterCatalog } from "../starterPacks";
import { flattenSteps } from "./build";
import {
  type ImportActionStep,
  type ImportItem,
  type ImportParameter,
  type ImportStep,
  type ImportWorkflowSpec,
  isCounterReference,
} from "./types";

/**
 * Turns imported items into the exact shapes the workflow builder and command
 * editor send the engine, resolving canonical refs against the instance's
 * catalog the way starter packs do.
 */

const CHAT_COMMAND_PREFIX = "chat.command.";
/** The catalog trigger every chat command's event belongs to. */
const CHAT_COMMAND_TRIGGER = "chat.command.*";

const MODULE_NAMES: Record<string, string> = {
  woofx3_twitch: "the Twitch module",
  woofx3_obs: "the OBS module",
};

function refModule(ref: string): string {
  return ref.slice(0, ref.indexOf(":"));
}

function catalogTrigger(event: string, catalog: StarterCatalog) {
  const wanted = event.startsWith(CHAT_COMMAND_PREFIX) ? CHAT_COMMAND_TRIGGER : event;
  return catalog.triggers.find((entry) => entry.event === wanted);
}

/** Module of the trigger an event comes from: chat commands are the engine's, everything else Twitch's. */
function triggerModule(event: string): string {
  return event.startsWith(CHAT_COMMAND_PREFIX) ? "woofx3" : "woofx3_twitch";
}

function actionSteps(item: ImportItem): ImportActionStep[] {
  if (item.kind === "command") {
    return item.spec.steps;
  }
  if (item.kind === "workflow") {
    return flattenSteps(item.spec.steps).filter((step): step is ImportActionStep => step.kind === "action");
  }
  return [];
}

/**
 * Why the instance cannot create an item yet, in the streamer's terms, or null
 * when it can. A module that has some entries in the catalog but not the one
 * needed is installed in an older version.
 */
export function missingRequirementMessage(item: ImportItem, catalog: StarterCatalog): string | null {
  const missingModules = new Set<string>();
  for (const step of actionSteps(item)) {
    if (!catalog.actions.some((entry) => entry.canonicalRef === step.ref)) {
      missingModules.add(refModule(step.ref));
    }
  }
  if (item.kind === "workflow" && item.spec.trigger.kind === "event") {
    if (!catalogTrigger(item.spec.trigger.event, catalog)) {
      missingModules.add(triggerModule(item.spec.trigger.event));
    }
  }
  if (missingModules.size === 0) {
    return null;
  }
  const installed = (moduleId: string) =>
    [...catalog.actions, ...catalog.triggers].some(
      (entry) => entry.canonicalRef !== undefined && refModule(entry.canonicalRef) === moduleId
    );
  const needs = Array.from(missingModules)
    .sort()
    .map((moduleId) => {
      const name = MODULE_NAMES[moduleId];
      if (name === undefined) {
        return "a newer engine";
      }
      return installed(moduleId) ? `a newer version of ${name}` : name;
    });
  return `Needs ${needs.join(" and ")}.`;
}

/** Counter keys of this import mapped to the canonical ids of the counters they became. */
export type CounterIds = ReadonlyMap<string, string>;

function resolveParameters(parameters: Record<string, ImportParameter>, counters: CounterIds): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (isCounterReference(value)) {
      const canonicalId = counters.get(value.counterKey);
      if (canonicalId === undefined) {
        throw new Error("A counter this uses was not created.");
      }
      out[key] = canonicalId;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function stepId(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "step"}-${index}`;
}

/** A task as the workflow builder writes it: the canonical shape plus `$ref`, `function` and delay waits. */
export type ImportTask = Omit<TaskDefinition, "wait"> & {
  $ref?: string;
  function?: string;
  wait?: { type: "delay"; durationMs: number };
};

export type ImportWorkflowDefinition = Omit<WorkflowDefinition, "id" | "tasks" | "trigger"> & {
  trigger:
    | { type: "event"; event: string; conditions: ConditionConfig[]; $ref?: string }
    | { type: "schedule"; schedule: string };
  tasks: ImportTask[];
};

/** Longest delay the engine accepts: 24 hours. */
const MAX_DELAY_MS = 86_400_000;

class TaskWriter {
  readonly tasks: ImportTask[] = [];

  constructor(
    private readonly catalog: StarterCatalog,
    private readonly counters: CounterIds
  ) {}

  /** Writes the steps in order and returns the ids of every task they became, nested ones included. */
  write(steps: readonly ImportStep[]): string[] {
    const ids: string[] = [];
    for (const step of steps) {
      ids.push(...this.writeStep(step));
    }
    return ids;
  }

  private push(task: ImportTask): string {
    const previous = this.tasks.at(-1);
    // Runs are sequential; chaining every task keeps them in source order.
    // A task that depends on a skipped branch task still runs.
    if (previous) {
      task.dependsOn = [previous.id];
    }
    this.tasks.push(task);
    return task.id;
  }

  private writeStep(step: ImportStep): string[] {
    const id = stepId(step.label, this.tasks.length + 1);
    if (step.kind === "action") {
      const { handlerType, functionCall } = catalogAction(step.ref, this.catalog);
      const task: ImportTask = {
        id,
        type: "action",
        action: handlerType,
        parameters: resolveParameters(step.parameters, this.counters),
        $ref: step.ref,
      };
      if (functionCall) {
        task.function = functionCall;
      }
      return [this.push(task)];
    }
    if (step.kind === "delay") {
      const durationMs = Math.min(MAX_DELAY_MS, Math.max(1, Math.round(step.ms)));
      return [this.push({ id, type: "wait", wait: { type: "delay", durationMs } })];
    }
    // A condition skips the side not taken for the whole run, and a skip does
    // not pass on to dependents, so each side lists every task under it,
    // nested branches' tasks included.
    const condition: ImportTask = {
      id,
      type: "condition",
      conditions: step.conditions,
      conditionLogic: step.logic,
      onTrue: [],
      onFalse: [],
    };
    this.push(condition);
    condition.onTrue = this.write(step.whenTrue);
    condition.onFalse = this.write(step.whenFalse);
    return [id, ...condition.onTrue, ...condition.onFalse];
  }
}

export function compileWorkflow(
  spec: ImportWorkflowSpec,
  catalog: StarterCatalog,
  counters: CounterIds
): ImportWorkflowDefinition {
  const writer = new TaskWriter(catalog, counters);
  if (spec.trigger.kind === "schedule") {
    writer.write(spec.steps);
    return {
      name: spec.name,
      description: spec.description,
      trigger: { type: "schedule", schedule: spec.trigger.schedule },
      tasks: writer.tasks,
    };
  }

  const { event, conditions, logic } = spec.trigger;
  const anyOf = logic === "or" && conditions.length > 1;
  writer.write(
    anyOf
      ? [{ kind: "branch", label: "Filters", conditions, logic: "or", whenTrue: spec.steps, whenFalse: [] }]
      : spec.steps
  );
  const trigger: ImportWorkflowDefinition["trigger"] = { type: "event", event, conditions: anyOf ? [] : conditions };
  const entry = catalogTrigger(event, catalog);
  if (entry?.canonicalRef) {
    trigger.$ref = entry.canonicalRef;
  }
  return { name: spec.name, description: spec.description, trigger, tasks: writer.tasks };
}

export function compileCommandActions(
  steps: readonly ImportActionStep[],
  catalog: StarterCatalog,
  counters: CounterIds
): ActionStep[] {
  return steps.map((step, index): ActionStep => {
    const { handlerType, functionCall } = catalogAction(step.ref, catalog);
    const action: ActionStep = {
      id: stepId(step.label, index + 1),
      action: handlerType,
      parameters: resolveParameters(step.parameters, counters),
      $ref: step.ref,
    };
    if (functionCall) {
      action.function = functionCall;
    }
    return action;
  });
}
