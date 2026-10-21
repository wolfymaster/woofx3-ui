import type { EventLogSelection, StreamEventFrame } from "@woofx3/api";
import { alertEvent } from "@/lib/alert-envelope";
import type { EventFacts } from "@/lib/alert-summary";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * The Events widget's feed: one row per thing that happened.
 *
 * Rows are every alert, plus every event of an enabled type that no alert
 * claims. An alert is an attachment to the event that caused it, never a row
 * of its own, so one event that played two alerts is one row carrying both.
 * Alerts always show, whatever the selection: someone configured them, which
 * makes them meaningful by definition.
 *
 * Which types are enabled is the engine's: one selection per engine
 * (`EventLogSettings`), which also decides what it logs and pushes.
 */

/**
 * The CloudEvent `source` the engine's api stamps on events the dashboard fires
 * on purpose: the Alerts page's test alert, the debug page's triggers. Real
 * events never carry it, and a test is not activity.
 */
export const TEST_EVENT_SOURCE = "api";

/** A logged or pushed event. History always has an id; a pushed frame without one is given one on arrival. */
export type ActivityEvent = StreamEventFrame & { id: string };

/** The fields of an engine alert the feed reads. */
export interface ActivityAlert {
  id: string;
  /** Epoch ms the dashboard first heard of the alert; its time when the engine sent none. */
  createdAt: number;
  sourceEventId?: string;
  payload?: string;
  engineCreatedAt?: string;
}

export interface ActivityRow<A extends ActivityAlert = ActivityAlert> {
  /** Stable across renders: the event's id, or the alert's when it has no event. */
  key: string;
  /** Epoch ms: the event's time, or the alert's when it has no event. */
  time: number;
  /** What happened, from the event log or push, else from the event the alert carries. Null for an alert with no event. */
  event: EventFacts | null;
  /** Newest first; empty for an event no alert claims. */
  alerts: A[];
}

function parseTime(time: string | null | undefined): number | null {
  if (!time) {
    return null;
  }
  const parsed = Date.parse(time);
  return Number.isNaN(parsed) ? null : parsed;
}

function alertTime(alert: ActivityAlert): number {
  return parseTime(alert.engineCreatedAt) ?? alert.createdAt;
}

function dataOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The feed's rows, newest first.
 *
 * An alert joins its event by `sourceEventId`, else by the id of the event its
 * envelope carries. An event or alert whose originating CloudEvent came from
 * the dashboard itself (`TEST_EVENT_SOURCE`) is dropped. `events` may hold the
 * same event twice (history and push overlap); the first copy wins.
 *
 * `enabledTypes` null shows every event given, for an engine that predates the
 * selection and pushes its own fixed set.
 */
export function mergeActivity<A extends ActivityAlert>(
  events: readonly ActivityEvent[],
  alerts: readonly A[],
  enabledTypes: ReadonlySet<string> | null
): ActivityRow<A>[] {
  const eventsById = new Map<string, ActivityEvent>();
  for (const event of events) {
    if (event.source !== TEST_EVENT_SOURCE && !eventsById.has(event.id)) {
      eventsById.set(event.id, event);
    }
  }

  const rows: ActivityRow<A>[] = [];
  const rowsByEventId = new Map<string, ActivityRow<A>>();
  for (const alert of alerts) {
    const carried = alertEvent(alert.payload);
    if (carried?.source === TEST_EVENT_SOURCE) {
      continue;
    }
    const eventId = alert.sourceEventId || carried?.id || null;
    if (!eventId) {
      rows.push({ key: `alert:${alert.id}`, time: alertTime(alert), event: null, alerts: [alert] });
      continue;
    }
    const existing = rowsByEventId.get(eventId);
    if (existing) {
      existing.alerts.push(alert);
      continue;
    }
    const logged = eventsById.get(eventId);
    const row: ActivityRow<A> = logged
      ? {
          key: eventId,
          time: parseTime(logged.time) ?? alertTime(alert),
          event: { type: logged.type, data: dataOf(logged.data) },
          alerts: [alert],
        }
      : {
          key: eventId,
          time: parseTime(carried?.time) ?? alertTime(alert),
          event: carried ? { type: carried.type, data: carried.data } : null,
          alerts: [alert],
        };
    rowsByEventId.set(eventId, row);
    rows.push(row);
  }

  eventsById.forEach((event, id) => {
    if (rowsByEventId.has(id) || (enabledTypes && !enabledTypes.has(event.type))) {
      return;
    }
    rows.push({
      key: id,
      time: parseTime(event.time) ?? 0,
      event: { type: event.type, data: dataOf(event.data) },
      alerts: [],
    });
  });

  for (const row of rows) {
    row.alerts.sort((a, b) => alertTime(b) - alertTime(a));
  }
  return rows.sort((a, b) => b.time - a.time || a.key.localeCompare(b.key));
}

/**
 * The selection with one event type turned on or off. The selection is stored
 * as overrides on the engine's defaults, so an override is kept only where the
 * choice differs from the default, and `hidden` wins over `shown`:
 *
 * - on, a default: drop it from `hidden`.
 * - on, not a default: add it to `shown` (and drop it from `hidden`).
 * - off, a default: add it to `hidden`.
 * - off, not a default: drop it from `shown`.
 */
export function withEventTypeEnabled(
  selection: EventLogSelection,
  defaults: readonly string[],
  type: string,
  enabled: boolean
): EventLogSelection {
  const shown = selection.shown.filter((entry) => entry !== type);
  const hidden = selection.hidden.filter((entry) => entry !== type);
  const isDefault = defaults.includes(type);
  if (enabled && !isDefault) {
    shown.push(type);
  }
  if (!enabled && isDefault) {
    hidden.push(type);
  }
  return { shown, hidden };
}

/** One offered event type, as the filter lists it. */
export interface EventTypeOption {
  type: string;
  /** The trigger's name, or the raw type when no installed trigger fires on it. */
  label: string;
}

export interface EventTypeGroup {
  /** The module's display name. */
  source: string;
  types: EventTypeOption[];
}

/** Label for event types no installed trigger claims, and for triggers whose module is unknown. */
export const UNKNOWN_SOURCE_LABEL = "Other";

/**
 * Every installed trigger by the event type it fires on. An eventbus trigger
 * wins over another kind claiming the same type, since that is the one the
 * event itself fires; otherwise the first one wins.
 */
export function triggersByEventType(presets: readonly TriggerPreset[]): Map<string, TriggerPreset> {
  const triggers = new Map<string, TriggerPreset>();
  for (const preset of presets) {
    if (!preset.event) {
      continue;
    }
    const current = triggers.get(preset.event);
    if (!current || (!isEventbusTrigger(current) && isEventbusTrigger(preset))) {
      triggers.set(preset.event, preset);
    }
  }
  return triggers;
}

/** Engines that predate the trigger's `transport` field only sent eventbus triggers. */
function isEventbusTrigger(preset: Pick<TriggerPreset, "transport">): boolean {
  return preset.transport === undefined || preset.transport === "eventbus";
}

/**
 * The event types the engine offers, grouped by the module of the trigger
 * that fires on each, both alphabetical, for the filter's checklist.
 */
export function eventTypeGroups(
  offered: readonly string[],
  triggersByType: ReadonlyMap<string, TriggerPreset>
): EventTypeGroup[] {
  const groups = new Map<string, EventTypeOption[]>();
  for (const type of new Set(offered)) {
    const trigger = triggersByType.get(type);
    const source = trigger?.source ?? UNKNOWN_SOURCE_LABEL;
    const group = groups.get(source) ?? [];
    group.push({ type, label: trigger?.name ?? type });
    groups.set(source, group);
  }
  return Array.from(groups, ([source, types]) => ({
    source,
    types: types.sort((a, b) => a.label.localeCompare(b.label) || a.type.localeCompare(b.type)),
  })).sort((a, b) => a.source.localeCompare(b.source));
}
