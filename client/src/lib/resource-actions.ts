import type { ActionStep } from "@woofx3/api";
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
