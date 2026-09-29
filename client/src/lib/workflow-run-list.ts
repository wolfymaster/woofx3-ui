import type { WorkflowRun } from "@/lib/transport";

/** capnweb may deliver a timestamp as a Date or as its serialized string. */
function timeKey(value: Date | string | undefined): string {
  if (value === undefined) {
    return "";
  }
  return value instanceof Date ? String(value.getTime()) : String(value);
}

function sameRun(a: WorkflowRun, b: WorkflowRun): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.workflowName === b.workflowName &&
    a.error === b.error &&
    a.progress === b.progress &&
    timeKey(a.completedAt) === timeKey(b.completedAt)
  );
}

/**
 * Folds one polled run into the newest-first list. Returns `runs` itself when
 * the run is already present and unchanged, so a poll that brings nothing new
 * does not re-render the list.
 */
export function mergeWorkflowRun(runs: WorkflowRun[], run: WorkflowRun, limit: number): WorkflowRun[] {
  const index = runs.findIndex((existing) => existing.id === run.id);
  if (index >= 0) {
    if (sameRun(runs[index], run)) {
      return runs;
    }
    const next = [...runs];
    next[index] = run;
    return next;
  }
  return [run, ...runs].slice(0, limit);
}
