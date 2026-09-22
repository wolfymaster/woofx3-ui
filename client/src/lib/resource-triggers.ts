import type { TriggerPreset } from "@/lib/workflow-presets";

/** A trigger that can be narrowed to one instance of a resource kind, and the field that does it. */
export interface ResourceTrigger {
  preset: TriggerPreset;
  /** The trigger's `resource_ref` condition field for the kind. */
  fieldId: string;
}

/**
 * The triggers a resource page offers for one kind: every eventbus trigger with a
 * `resource_ref` condition field for that kind, which is how a module says "this
 * event is about one of these" (a timer ending, an entry joining a queue).
 *
 * Found by declaration rather than listed per kind, so a module that adds a trigger
 * about a kind — its own or another module's — shows up on that kind's page.
 * Ordered by name, as the Alerts menu orders its events.
 */
export function resourceTriggers(triggerPresets: TriggerPreset[], kind: string): ResourceTrigger[] {
  const found: ResourceTrigger[] = [];
  for (const preset of triggerPresets) {
    if (!preset.event) {
      continue;
    }
    const field = preset.config?.fields.find(
      (candidate) => candidate.type === "resource_ref" && candidate.resourceKind === kind
    );
    if (field) {
      found.push({ preset, fieldId: field.id });
    }
  }
  return found.sort((a, b) => a.preset.name.localeCompare(b.preset.name));
}
