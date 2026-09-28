/**
 * How the answers to the operator controls over the engine's alert queue are
 * worded.
 *
 * The controls show no queue depth. The alert log cannot tell a waiting alert
 * from one on screen: the engine records every alert as `sent` when it is
 * published, and the `playing` transition has no webhook, so both look the
 * same here until they settle. Only the engine's answer is reported.
 */

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
