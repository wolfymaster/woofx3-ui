import type { ConditionConfig } from "@woofx3/api";

/**
 * The trigger fields an identity can be built from. The engine refuses to
 * merge a trigger carrying any other field, so an identity here must refuse it
 * too (`db/app/services/workflow_merge.go`, `mergeTriggerFields`).
 */
const MERGE_TRIGGER_FIELDS = new Set(["$ref", "type", "event", "conditions", "order"]);

export type TriggerFields = Record<string, unknown> & { type?: unknown; event?: unknown; conditions?: unknown };

/** JSON with object keys sorted, as Go's `json.Marshal` writes a `map[string]any`. */
function canonicalJson(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object") {
    const written = JSON.stringify(value);
    return written === undefined ? undefined : written;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalJson(item) ?? "null");
    return `[${items.join(",")}]`;
  }
  const entries: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const written = canonicalJson((value as Record<string, unknown>)[key]);
    if (written !== undefined) {
      entries.push(`${JSON.stringify(key)}:${written}`);
    }
  }
  return `{${entries.join(",")}}`;
}

/** The canonical condition set: sorted, de-duplicated, with keys sorted inside each condition. */
function canonicalConditions(conditions: readonly unknown[]): string | undefined {
  const written: string[] = [];
  for (const condition of conditions) {
    if (condition === null || typeof condition !== "object" || Array.isArray(condition)) {
      return undefined;
    }
    const value = canonicalJson(condition);
    if (value === undefined) {
      return undefined;
    }
    written.push(value);
  }
  return Array.from(new Set(written)).sort().join("\0");
}

/**
 * The condition half of a trigger's identity, for callers that already hold a
 * parsed trigger. Matches the sorted, compacted condition strings in the
 * engine's `triggerIdentity`.
 */
export function conditionSetKey(conditions: readonly ConditionConfig[]): string {
  return canonicalConditions(conditions) ?? "";
}

/**
 * What makes two event triggers the same trigger: the event and the set of
 * conditions, in any order. `undefined` when the engine would refuse to merge
 * the trigger: a non-event trigger, no event, an unknown field or an unreadable
 * condition. Must agree with `triggerIdentity` in
 * `db/app/services/workflow_merge.go`.
 */
export function triggerIdentity(trigger: TriggerFields): string | undefined {
  if (trigger === null || typeof trigger !== "object" || Array.isArray(trigger)) {
    return undefined;
  }
  for (const field of Object.keys(trigger)) {
    if (!MERGE_TRIGGER_FIELDS.has(field)) {
      return undefined;
    }
  }
  if (trigger.type !== "event" || typeof trigger.event !== "string" || trigger.event === "") {
    return undefined;
  }
  const conditions = trigger.conditions === undefined ? [] : trigger.conditions;
  if (!Array.isArray(conditions)) {
    return undefined;
  }
  const key = canonicalConditions(conditions);
  if (key === undefined) {
    return undefined;
  }
  return `${trigger.event}\0${key}`;
}

/** The identity of an event and its conditions, for definitions already parsed. */
export function eventConditionIdentity(event: string, conditions: readonly ConditionConfig[]): string {
  return `${event}\0${conditionSetKey(conditions)}`;
}
