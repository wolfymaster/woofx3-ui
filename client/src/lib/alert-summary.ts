import type { ConfigField, DataShapeField } from "@woofx3/api/ui-schema";
import { alertEventData, alertEventType, alertTarget } from "@/lib/alert-envelope";
import type { TriggerPreset } from "@/lib/workflow-presets";

/** What an alert row says: who did what, and the few facts worth a glance. */
export interface AlertSummary {
  title: string;
  details: string[];
}

/** The part of a trigger an alert is read through. */
export type AlertSummarySource = Pick<TriggerPreset, "name" | "emits" | "summary" | "summaryDetails" | "config">;

const ANONYMOUS = "Anonymous";

/**
 * How a recent alert reads, e.g. "wolfy_fan redeemed Hydrate" with the
 * viewer's message underneath.
 *
 * The module that declares a trigger knows what its event means, so the
 * wording is its `emits.summary` and `emits.details`, filled from the event
 * the alert carries. A trigger that declares no summary, or whose event lacks
 * a value the summary needs, still reads as who it was about and what
 * happened ("wolfy_fan · Channel follow") whenever its `emits` marks an
 * identity. An alert with no originating event, or one no trigger claims,
 * reads as it always has: the trigger's name, or the alert widget it went to.
 */
export function describeAlert(payload: string | undefined, trigger: AlertSummarySource | undefined): AlertSummary {
  const event = alertEventType(payload);
  const data = alertEventData(payload);
  const target = alertTarget(payload);
  const name = trigger?.name ?? event ?? (target ? `Alert → ${target}` : "Alert");
  if (!trigger || !data) {
    return { title: name, details: [] };
  }

  const fields = trigger.emits ?? [];
  const resolve = (path: string) => placeholderValue(path, data, fields, trigger.config?.fields ?? []);
  const summary = trigger.summary ? fillTemplate(trigger.summary, resolve) : null;
  const details = (trigger.summaryDetails ?? [])
    .map((detail) => fillTemplate(detail, resolve))
    .filter((detail): detail is string => detail !== null);
  if (summary) {
    return { title: summary, details };
  }
  const who = identityName(data, fields);
  return { title: who ? `${who} · ${name}` : name, details };
}

/**
 * The template with each `{path}` filled, or null when any placeholder has no
 * value to show: a half-filled line ("redeemed {rewardTitle}") reads worse
 * than the fallback. Barkloader rejects malformed braces at install; a
 * template that slips through anyway is treated as unfillable.
 */
function fillTemplate(template: string, resolve: (path: string) => string | null): string | null {
  let out = "";
  let at = 0;
  while (at < template.length) {
    const open = template.indexOf("{", at);
    if (open === -1) {
      out += template.slice(at);
      break;
    }
    const close = template.indexOf("}", open);
    if (close === -1) {
      return null;
    }
    const value = resolve(template.slice(open + 1, close));
    if (value === null) {
      return null;
    }
    out += template.slice(at, open) + value;
    at = close + 1;
  }
  return out.trim() || null;
}

/**
 * How one event value reads, or null when there is nothing to show.
 *
 * An identity reads as its display name, and as "Anonymous" when the event
 * withholds it: an anonymous gift still carries a placeholder name the viewer
 * asked not to show. A value one of the trigger's select fields lists reads
 * as that option's label ("1000" → "Tier 1"). Only strings and numbers fill a
 * placeholder; a boolean, list or object has no wording of its own.
 */
function placeholderValue(
  path: string,
  data: Record<string, unknown>,
  fields: readonly DataShapeField[],
  configFields: readonly ConfigField[]
): string | null {
  const identity = fields.find((field) => field.identity && (field.path === path || field.displayName === path));
  if (identity) {
    if (identity.anonymousWhen && valueAt(data, identity.anonymousWhen) === true) {
      return ANONYMOUS;
    }
    // An id is not a name; show the name the identity points at when it has one.
    if (identity.path === path && identity.displayName) {
      return textOf(valueAt(data, identity.displayName));
    }
  }

  const raw = valueAt(data, path);
  const text = textOf(raw);
  if (text === null || typeof raw !== "string") {
    return text;
  }
  const label = configFields
    .find((field) => field.type === "select" && (field.eventPath ?? field.id) === path)
    ?.options?.find((option) => option.value === raw)?.label;
  return label ?? text;
}

/** Who the event is about, from the first identity its trigger marks, or null. */
function identityName(data: Record<string, unknown>, fields: readonly DataShapeField[]): string | null {
  for (const field of fields) {
    if (!field.identity || field.type !== "string") {
      continue;
    }
    if (field.anonymousWhen && valueAt(data, field.anonymousWhen) === true) {
      return ANONYMOUS;
    }
    const name = field.displayName ? textOf(valueAt(data, field.displayName)) : null;
    if (name) {
      return name;
    }
  }
  return null;
}

function valueAt(data: Record<string, unknown>, path: string): unknown {
  let value: unknown = data;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function textOf(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : null;
  }
  if (typeof value === "string") {
    return value.trim() || null;
  }
  return null;
}
