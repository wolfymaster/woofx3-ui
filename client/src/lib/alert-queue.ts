/**
 * What the alert log says about the engine's alert queue, and how the answers
 * to the operator controls over it are worded.
 *
 * The log is a recent window mirrored through webhooks, so the counts here are
 * a hint for the operator, never a gate: the engine is asked regardless, and
 * its answer is what the toast reports.
 */

/** Statuses of an alert still waiting for its turn. The engine's own values, mirrored in `engineAlerts`. */
const WAITING_STATUSES: ReadonlySet<string> = new Set(["pending"]);

/** Statuses of an alert handed to an overlay and not yet settled. */
const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(["dispatched", "playing"]);

export interface AlertQueueSnapshot {
  /** Alerts in the window still waiting to play. */
  waiting: number;
  /** Whether an alert in the window is playing now. */
  playing: boolean;
}

export function alertQueueSnapshot(alerts: ReadonlyArray<{ status: string }>): AlertQueueSnapshot {
  let waiting = 0;
  let playing = false;
  for (const alert of alerts) {
    if (WAITING_STATUSES.has(alert.status)) {
      waiting += 1;
    } else if (IN_FLIGHT_STATUSES.has(alert.status)) {
      playing = true;
    }
  }
  return { waiting, playing };
}

export interface QueueToast {
  title: string;
  description: string;
}

export function skipResultToast(result: { skipped: boolean }): QueueToast {
  if (result.skipped) {
    return { title: "Alert skipped", description: "The next alert in the queue plays now." };
  }
  return { title: "Nothing to skip", description: "No alert was playing." };
}

export function clearResultToast(result: { cleared: number }): QueueToast {
  if (!Number.isInteger(result.cleared) || result.cleared < 0) {
    throw new Error(`cleared must be a non-negative integer, got ${String(result.cleared)}`);
  }
  if (result.cleared === 0) {
    return { title: "Queue already empty", description: "No alerts were waiting." };
  }
  const noun = result.cleared === 1 ? "alert" : "alerts";
  return {
    title: "Queue cleared",
    description: `Dropped ${result.cleared} waiting ${noun}. The one playing now finishes.`,
  };
}

/** The question the Clear button asks before it acts. */
export function clearConfirmLabel(waiting: number): string {
  if (waiting <= 0) {
    return "Clear the queue?";
  }
  return waiting === 1 ? "Drop 1 waiting alert?" : `Drop ${waiting} waiting alerts?`;
}
