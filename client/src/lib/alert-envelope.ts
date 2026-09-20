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

/**
 * The CloudEvent type that led to the alert, e.g. `channel.follow`, or null.
 *
 * Null for alerts with no originating event — a manual fire, a schedule, a
 * chat command — which the engine stamps as `"event": null`.
 */
export function alertEventType(payload: string | undefined): string | null {
  const event = parseEnvelope(payload)?.event;
  if (!event || typeof event !== "object") {
    return null;
  }
  return nonEmptyString((event as { type?: unknown }).type);
}
