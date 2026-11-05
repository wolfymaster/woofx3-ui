import type { OverlayPresence } from "@/engine/types";

/** How often an open page asks the engine whether an overlay is open. Nothing reports it opening or closing. */
export const OVERLAY_PRESENCE_POLL_MS = 3_000;

/** Must match NO_OVERLAY_OPEN in the engine's sceneManager/src/events/alert-controls.ts. */
const NO_OVERLAY_OPEN = "no overlay is open";

/**
 * Reads presence out of the engine's queue answer. `ok: false` also covers a
 * scene manager that did not answer, which must not read as the overlay
 * having closed, so only the engine's own reason does.
 */
export function overlayPresenceOf(queue: { ok: boolean; reason?: string }): OverlayPresence {
  if (queue.ok) {
    return "open";
  }
  return queue.reason === NO_OVERLAY_OPEN ? "closed" : "unknown";
}
