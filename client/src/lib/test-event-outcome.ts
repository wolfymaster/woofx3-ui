import { describeAlertFailure } from "./alert-failure";

/**
 * What became of a manually fired test event.
 *
 * Firing publishes an event and returns immediately; whether a workflow
 * matched it, and how that run ended, is decided afterwards in another
 * process and arrives as a transient record keyed by the id the trigger
 * carried. This turns that record into something a form can render.
 *
 * Kept out of the component because this repo has no component tests -- every
 * test here is pure logic under `lib/` -- and because the interesting part is
 * the decision, not the markup.
 */
export type TestEventOutcome =
  | { kind: "waiting" }
  | { kind: "running" }
  | { kind: "succeeded" }
  | { kind: "nothingMatched" }
  | { kind: "failed"; title: string; detail: string };

/** The fields of a `transientEvents` row this cares about. */
export interface RunRecord {
  status: "progress" | "success" | "error";
  message?: string;
}

/**
 * `record` is undefined while the subscription is loading and null when no row
 * exists yet. Those are the same thing -- nothing has arrived -- until the
 * caller's wait elapses, at which point the absence becomes the answer.
 *
 * That distinction only works because the engine announces `workflow.run.started`
 * as well as the terminal events: a run that matched says so immediately, so
 * continued silence really does mean nothing was listening, rather than a slow
 * workflow still working.
 */
export function describeTestEventOutcome(record: RunRecord | null | undefined, waitElapsed: boolean): TestEventOutcome {
  if (record === undefined || record === null) {
    return waitElapsed && record === null ? { kind: "nothingMatched" } : { kind: "waiting" };
  }

  switch (record.status) {
    case "progress":
      return { kind: "running" };
    case "success":
      return { kind: "succeeded" };
    default: {
      // The engine and the scene manager share one vocabulary for refusals, so
      // the mapping written for alert failures reads a workflow failure too --
      // a step refused by validateAlertParams arrives here word for word.
      const friendly = record.message ? describeAlertFailure(record.message) : null;
      return {
        kind: "failed",
        title: friendly?.title ?? "The workflow failed",
        detail: friendly?.hint ?? record.message ?? "No reason was reported.",
      };
    }
  }
}
