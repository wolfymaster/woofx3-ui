/**
 * One recorded run of a workflow, reached from that workflow's Runs panel. It
 * sits under the workflow so the back link returns to the workflow rather than
 * to the alert feed, which is where the alert-run route leads.
 */
export const WORKFLOW_RUN_ROUTE = "/stream/workflows/:id/runs/:engineRunId";

/** The query parameter that opens a workflow's editor on a given tab. */
export const WORKFLOW_TAB_PARAM = "tab";

export type WorkflowEditorTab = "steps" | "runs";

export function workflowRunPath(engineWorkflowId: string, engineRunId: string): string {
  return `/stream/workflows/${encodeURIComponent(engineWorkflowId)}/runs/${encodeURIComponent(engineRunId)}`;
}

/** A workflow's Runs tab, where the back link from one of its runs leads. */
export function workflowRunsPath(engineWorkflowId: string): string {
  return `/stream/workflows/${encodeURIComponent(engineWorkflowId)}?${WORKFLOW_TAB_PARAM}=runs`;
}

/** The editor tab a `location.search` string asks for; the steps unless it names the runs. */
export function workflowEditorTab(search: string): WorkflowEditorTab {
  return new URLSearchParams(search).get(WORKFLOW_TAB_PARAM) === "runs" ? "runs" : "steps";
}
