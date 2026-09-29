import type { NotRunningWorkflow } from "@convex/workflowHealth";

export type { NotRunningWorkflow };

/** Short label for a workflow the engine refused to set up. */
export const NOT_RUNNING_LABEL = "Not running on its own";

/**
 * A refused workflow can often still be run by hand (a test event, "Run now"),
 * so the copy says it will not fire by itself rather than that it is dead.
 */
export const NOT_RUNNING_EXPLANATION = "The engine couldn't set this workflow up, so it won't fire on its own.";

/** Shown when the engine reported the problem without a reason. */
export const NO_REASON_GIVEN = "The engine didn't say why.";

/** Dashboard sentence for how many enabled workflows are not running; empty when none. */
export function notRunningSummary(count: number): string {
  if (count <= 0) {
    return "";
  }
  if (count === 1) {
    return "1 automation isn't running on its own";
  }
  return `${count} automations aren't running on their own`;
}

/** Index the not-running list by engine workflow id, for per-row lookups. */
export function notRunningById(
  list: readonly NotRunningWorkflow[] | undefined
): ReadonlyMap<string, NotRunningWorkflow> {
  return new Map((list ?? []).map((entry) => [entry.engineWorkflowId, entry]));
}
