/**
 * The stream events (a follow, a cheer, an ad break) the engine forwards as
 * `stream.event.pushed` callbacks, for the dashboard's live feed.
 *
 * The shapes must match `StreamEventPushedEvent` and `StreamEventFrame` in
 * woofx3 shared/clients/typescript/api. They are declared here rather than
 * imported because the callback body is untrusted JSON either way.
 *
 * A frame is kept as a transient event under one correlation key per
 * instance. The feed carries only what happened since a dashboard last read
 * the engine's event log, so a short life is enough: a gap is closed by that
 * read, never by this table.
 */

export const STREAM_EVENT_PUSHED_EVENT_TYPE = "stream.event.pushed";

/** The transient-event key every instance's stream events are stored under. */
export const STREAM_EVENT_CORRELATION_KEY = "stream-events";

/** How long a stream event stays readable. */
export const STREAM_EVENT_TTL_MS = 5 * 60_000;

/** The newest frames a subscriber is shown at once; older ones are in the engine's log. */
export const STREAM_EVENT_WINDOW = 100;

export interface PushedStreamFrame {
  id?: string;
  type: string;
  source: string;
  time: string;
  platform?: string;
  data: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The frame a callback carries, or null when it lacks the fields every frame has. */
export function readPushedFrame(value: unknown): PushedStreamFrame | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const frame = value as Record<string, unknown>;
  if (typeof frame.type !== "string" || frame.type === "" || typeof frame.time !== "string") {
    return null;
  }
  const id = optionalString(frame.id);
  const platform = optionalString(frame.platform);
  return {
    ...(id !== undefined ? { id } : {}),
    type: frame.type,
    source: optionalString(frame.source) ?? "engine",
    time: frame.time,
    ...(platform !== undefined ? { platform } : {}),
    data: frame.data,
  };
}
