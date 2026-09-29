import { AlertTriangle, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useNotRunningWorkflows } from "@/hooks/use-workflow-health";
import { notRunningSummary } from "@/lib/workflow-health";

const WORKFLOWS_PATH = "/stream/workflows";

/** One line above the dashboard when any enabled workflow is not running, linking to the list. */
export function NotRunningNotice() {
  const { list } = useNotRunningWorkflows();
  const summary = notRunningSummary(list?.length ?? 0);
  if (!summary) {
    return null;
  }
  return (
    <Link
      href={WORKFLOWS_PATH}
      className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-red-700 hover:bg-destructive/15 dark:text-red-300"
      data-testid="link-workflows-not-running"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{summary}</span>
      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
    </Link>
  );
}
