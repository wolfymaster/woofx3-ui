// The transition and effect kinds a widget declares it plays itself, as the
// widget catalog mirrors them from the engine (`WidgetDefinition.behaviorKinds`
// on the MODULE_WIDGET_REGISTERED webhook and `getAvailableWidgets`). The
// editor offers these after the host kinds every widget gets.

/** One declared kind: `id` is what a behavior's `kind` names, `label` what an editor shows. */
export interface WidgetBehaviorKind {
  id: string;
  label: string;
}

export interface WidgetBehaviorKinds {
  transitions: WidgetBehaviorKind[];
  effects: WidgetBehaviorKind[];
}

/**
 * A declared kind's id. Must match `KIND_ID` in the engine's scene model
 * (shared/clients/typescript/scene/model/entity-types.ts), which refuses
 * any other.
 */
const KIND_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** Longest label kept; a longer one is cut, since it only names an option in a picker. */
export const BEHAVIOR_KIND_LABEL_MAX_LENGTH = 64;

/** Most kinds kept per behavior type, so a malformed payload cannot grow a catalog row without bound. */
export const MAX_DECLARED_KINDS = 32;

/**
 * The kinds a widget definition declares, read from an engine payload whatever
 * its shape. Anything that is not a list of `{ id, label }` reads as no kinds:
 * an engine from before widgets declared kinds sends no field at all. An entry
 * whose id the scene model would refuse is dropped, as is a repeat of an id
 * already read; a missing or blank label falls back to the id.
 */
export function readWidgetBehaviorKinds(value: unknown): WidgetBehaviorKinds {
  const raw = isRecord(value) ? value : {};
  return { transitions: readKindList(raw.transitions), effects: readKindList(raw.effects) };
}

function readKindList(value: unknown): WidgetBehaviorKind[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const kinds: WidgetBehaviorKind[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (kinds.length >= MAX_DECLARED_KINDS) {
      break;
    }
    if (!isRecord(entry)) {
      continue;
    }
    const { id, label } = entry;
    if (typeof id !== "string" || !KIND_ID.test(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const trimmed = typeof label === "string" ? label.trim().slice(0, BEHAVIOR_KIND_LABEL_MAX_LENGTH) : "";
    kinds.push({ id, label: trimmed === "" ? id : trimmed });
  }
  return kinds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
