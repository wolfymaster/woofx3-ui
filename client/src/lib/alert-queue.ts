import type { AlertClearResult, AlertReplayResult, AlertSkipResult } from "@convex/lib/alertQueueResults";
import { TRY_AGAIN } from "@/lib/copy";

/**
 * How the answers to the alert-queue controls are worded.
 *
 * The controls show no queue depth. The alert log cannot tell a waiting alert
 * from one on screen: the engine records every alert as `sent` when it is
 * published, and the `playing` transition has no webhook, so both look the
 * same here until they settle. Only the engine's answer is reported.
 */

export interface QueueToast {
  title: string;
  description: string;
  variant?: "destructive";
}

/** The engine's `reason` when no overlay is open to act on; alerts queue and play inside the overlay. */
const NO_OVERLAY_REASON = "no overlay is open";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The toast for an answer with `ok: false`. */
function refusalToast(reason: string | undefined, title: string): QueueToast {
  if (reason?.trim().toLowerCase().startsWith(NO_OVERLAY_REASON)) {
    return {
      variant: "destructive",
      title: "No overlay is open",
      description: "Open your overlay in your streaming software. Alerts queue and play there.",
    };
  }
  return { variant: "destructive", title, description: TRY_AGAIN };
}

export function skipResultToast(result: AlertSkipResult): QueueToast {
  if (!result.ok) {
    return refusalToast(result.reason, "Couldn't skip the alert");
  }
  if (result.skipped === 0) {
    return { title: "Nothing is playing", description: "There was no alert on screen to skip." };
  }
  return { title: `Skipped ${plural(result.skipped, "alert")}`, description: "The next alert in the queue plays now." };
}

export function clearResultToast(result: AlertClearResult): QueueToast {
  if (!result.ok) {
    return refusalToast(result.reason, "Couldn't clear the queue");
  }
  if (result.cleared === 0) {
    return { title: "Queue already empty", description: "No alerts were waiting." };
  }
  return {
    title: "Queue cleared",
    description: `Dropped ${plural(result.cleared, "waiting alert")}. The one playing now finishes.`,
  };
}

export function replayResultToast(result: AlertReplayResult): QueueToast {
  if (!result.ok) {
    return refusalToast(result.reason, "Couldn't replay the alert");
  }
  return { title: "Replaying", description: "The alert is queued on your open overlays." };
}
