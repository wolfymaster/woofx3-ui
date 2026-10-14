import type { StreamEventFrame } from "@woofx3/api";

/**
 * A local listener on the engine's stream-event push and the event types it
 * takes. `types` null takes every frame that arrives and asks the engine for no
 * type of its own; see `WoofxTransport.subscribeStreamEvents`.
 */
export interface StreamListener {
  types: ReadonlySet<string> | null;
  callback: (frame: StreamEventFrame) => void;
}

/** The event types to register with the engine: every listener's, unique and sorted, so equal sets compare equal. */
export function streamTypesUnion(listeners: readonly StreamListener[]): string[] {
  const union = new Set<string>();
  for (const listener of listeners) {
    listener.types?.forEach((type) => {
      union.add(type);
    });
  }
  return Array.from(union).sort();
}

/** Whether a frame of `type` goes to `listener`: the push carries the union, and each listener takes only its own. */
export function listenerTakes(listener: StreamListener, type: string): boolean {
  return listener.types === null || listener.types.has(type);
}
