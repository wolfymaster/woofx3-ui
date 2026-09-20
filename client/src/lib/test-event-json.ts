/** Hand-written event data: the object to fire, or why the text is not one. */
export type ParsedEventData = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };

/**
 * Parses the JSON view of a test event's data.
 *
 * An event's data is always an object — the engine merges it into the
 * CloudEvent it publishes — so a valid JSON array or string is rejected here
 * rather than firing something no workflow can read.
 */
export function parseEventData(text: string): ParsedEventData {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Event data must be a JSON object." };
  }
  return { ok: true, payload: value as Record<string, unknown> };
}
