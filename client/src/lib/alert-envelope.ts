/**
 * Reading an alert's stored envelope.
 *
 * The engine persists the `ui.notify.alert` payload verbatim as a JSON string
 * — `{ id, parameters, event }`, built by `buildAlertEnvelope` in the engine's
 * workflow actions. Nothing validates it on the way here, so every field is
 * read defensively and every reader tolerates its absence: the envelope is
 * evidence about an alert, never the reason the UI works.
 */

interface Envelope {
  parameters?: unknown;
  event?: unknown;
}

function parseEnvelope(payload: string | undefined): Envelope | null {
  if (!payload) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? (parsed as Envelope) : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The alert widget the dispatch was aimed at, or null.
 *
 * Matters most on the failure it cannot explain on its own — "no alert widget
 * named X on a running scene" reads very differently once you can see which X
 * was meant.
 */
export function alertTarget(payload: string | undefined): string | null {
  const parameters = parseEnvelope(payload)?.parameters;
  if (!parameters || typeof parameters !== "object") {
    return null;
  }
  return nonEmptyString((parameters as { target?: unknown }).target);
}

/** The originating CloudEvent an envelope carries, each field null when it is absent or malformed. */
export interface AlertEnvelopeEvent {
  id: string | null;
  type: string | null;
  /** `"api"` for an event the dashboard fired on purpose (a test alert); see lib/activity-feed.ts. */
  source: string | null;
  /** RFC3339. */
  time: string | null;
  data: Record<string, unknown> | null;
}

/**
 * The CloudEvent that led to the alert, or null.
 *
 * Null for alerts with no originating event — a manual fire, a schedule, a
 * chat command — which the engine stamps as `"event": null`.
 */
export function alertEvent(payload: string | undefined): AlertEnvelopeEvent | null {
  const event = parseEnvelope(payload)?.event;
  if (!event || typeof event !== "object") {
    return null;
  }
  const fields = event as { id?: unknown; type?: unknown; source?: unknown; time?: unknown; data?: unknown };
  const data = fields.data;
  return {
    id: nonEmptyString(fields.id),
    type: nonEmptyString(fields.type),
    source: nonEmptyString(fields.source),
    time: nonEmptyString(fields.time),
    data: data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null,
  };
}

/** The CloudEvent type that led to the alert, e.g. `channel.follow`, or null; see `alertEvent`. */
export function alertEventType(payload: string | undefined): string | null {
  return alertEvent(payload)?.type ?? null;
}

/**
 * The originating event's `data`, or null.
 *
 * Who followed, which reward, how many months: what makes an alert worth a
 * glance. Null for an alert with no originating event, and for an envelope
 * whose event carries no object `data`.
 */
export function alertEventData(payload: string | undefined): Record<string, unknown> | null {
  return alertEvent(payload)?.data ?? null;
}
