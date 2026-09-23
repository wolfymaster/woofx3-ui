import type { Doc } from "@convex/_generated/dataModel";
import type { ActionStep } from "@woofx3/api";
import { type ProjectedAction, projectWorkflow } from "@/lib/trigger-projection";
import type { ActionPreset } from "@/lib/workflow-presets";
import { presetToActionStep } from "@/lib/workflow-presets-json";

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
      (candidate) => candidate.type === "resource_ref" && candidate.resourceKind === kind
    );
    if (field) {
      found.push({ preset, fieldId: field.id });
    }
  }
  return found.sort((a, b) => a.preset.name.localeCompare(b.preset.name));
}

/** Whether this step runs one of `actions` aimed at `canonicalId`. */
export function aimsAtResource(action: ProjectedAction, actions: ResourceAction[], canonicalId: string): boolean {
  return actions.some(({ preset, fieldId }) => {
    const matches = action.functionCall
      ? preset.functionCall === action.functionCall
      : preset.handlerType === action.handlerType;
    return matches && action.parameters[fieldId] === canonicalId;
  });
}

/**
 * The events whose workflows already change this instance — which events a resource page
 * opens an editor for.
 *
 * A workflow this screen can't project is skipped rather than reported: its steps are not
 * editable here either way, and the workflow builder is where it is dealt with.
 */
export function eventsChangingResource(
  workflows: Doc<"workflows">[],
  actions: ResourceAction[],
  canonicalId: string
): string[] {
  const events = new Set<string>();
  for (const row of workflows) {
    const projected = projectWorkflow(row);
    if (!projected.ok) {
      continue;
    }
    const { projection } = projected;
    const steps = [...projection.triggers.flatMap((trigger) => trigger.actions), ...projection.shared];
    if (steps.some((action) => aimsAtResource(action, actions, canonicalId))) {
      events.add(projection.event);
    }
  }
  return Array.from(events).sort();
}
