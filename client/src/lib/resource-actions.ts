import { resourceKindMatches } from "@shared/resource-kinds";
import type { ActionStep, WorkflowDefinition } from "@woofx3/api";
import type { WorkflowRecord } from "@/engine/types";
import { stepsAimAt } from "@/lib/alert-triggers";
import { unescapeDollarKeys } from "@/lib/dollar-keys";
import type { ActionPreset } from "@/lib/workflow-presets";
import { presetToActionStep } from "@/lib/workflow-presets-json";
import { definitionToTree } from "@/lib/workflow-tree";

/**
 * The step that runs one of a module's actions against a resource instance —
 * what a counter page's +1 button sends, and exactly what a workflow step
 * configured with the same action would run.
 *
 * Built from the action catalog rather than written out here, so the page never
 * hard-codes a function id the module could rename: the module declares the
 * action, the catalog carries it, the page asks for it by name.
 */
export function resourceActionStep(
  actionPresets: ActionPreset[],
  moduleName: string,
  actionId: string,
  parameters: Record<string, unknown>
): ActionStep {
  const canonicalRef = `${moduleName}:action:${actionId}`;
  const preset = actionPresets.find((candidate) => candidate.canonicalRef === canonicalRef);
  if (!preset) {
    throw new Error(`The ${actionId} action isn't installed — update the ${moduleName} module to get it.`);
  }
  const step = presetToActionStep(preset, "action-1");
  return { ...step, parameters: { ...step.parameters, ...parameters } };
}

/** A step running `action` on the instance `canonicalId`, with `parameters` for its other fields. */
export function resourceActionStepFor(
  action: ResourceAction,
  canonicalId: string,
  parameters: Record<string, unknown>
): ActionStep {
  const step = presetToActionStep(action.preset, "action-1");
  return { ...step, parameters: { ...step.parameters, ...parameters, [action.fieldId]: canonicalId } };
}

/** An action that can be aimed at one instance of a resource kind, and the field that aims it. */
export interface ResourceAction {
  preset: ActionPreset;
  /** The action's `resource_ref` parameter for the kind. */
  fieldId: string;
}

/**
 * The actions a resource page offers for one kind: every action with a `resource_ref`
 * parameter for that kind, which is how a module says "this changes one of these"
 * (incrementing a counter, adding time to a timer).
 *
 * The mirror of resourceTriggers: found by declaration rather than listed per kind, so a
 * module that adds an action on a kind — its own or another module's — shows up on that
 * kind's page. Ordered by name, as the action picker orders its catalog.
 */
export function resourceActions(actionPresets: ActionPreset[], kind: string): ResourceAction[] {
  const found: ResourceAction[] = [];
  for (const preset of actionPresets) {
    const field = preset.config?.fields.find(
      (candidate) => candidate.type === "resource_ref" && resourceKindMatches(candidate.resourceKind, kind)
    );
    if (field) {
      found.push({ preset, fieldId: field.id });
    }
  }
  return found.sort((a, b) => a.preset.name.localeCompare(b.preset.name));
}

/**
 * The events whose triggers already change this instance — which events a resource page
 * lists triggers for. A step inside a condition counts.
 *
 * A workflow the step editor can't read is skipped rather than guessed at: its steps are
 * not editable from that list either way.
 */
export function eventsChangingResource(
  workflows: WorkflowRecord[],
  actions: ResourceAction[],
  canonicalId: string
): string[] {
  const events = new Set<string>();
  for (const row of workflows) {
    const definition = unescapeDollarKeys(row.definition) as WorkflowDefinition | undefined;
    if (!definition || definition.trigger?.type !== "event") {
      continue;
    }
    const read = definitionToTree(definition);
    if (read.editable && stepsAimAt(read.tree.steps, actions, canonicalId)) {
      events.add(definition.trigger.event);
    }
  }
  return Array.from(events).sort();
}
