import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDuration, toneFor } from "@/lib/workflow-run-timeline";
import { TONE_STYLE } from "./tone";

export type RunRow = FunctionReturnType<typeof api.workflowRuns.listForInstance>[number];

function formatTimeAgo(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function durationOf(run: RunRow): number | undefined {
  if (!run.startedAt || !run.completedAt) {
    return undefined;
  }
  const ms = Date.parse(run.completedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

interface RunListProps {
  runs: RunRow[];
  selectedRunId: string | null;
  onSelect: (engineRunId: string) => void;
}

/** One line per recorded run, newest first. */
export function RunList({ runs, selectedRunId, onSelect }: RunListProps) {
  return (
    <ul className="divide-y divide-border" data-testid="alert-history-run-list">
      {runs.map((run) => {
        const style = TONE_STYLE[toneFor(run.status)];
        const Icon = style.icon;
        const selected = run.engineRunId === selectedRunId;
        const duration = formatDuration(durationOf(run));
        return (
          <li key={run._id}>
            <button
              type="button"
              onClick={() => onSelect(run.engineRunId)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                selected && "bg-muted"
              )}
              aria-current={selected ? "true" : undefined}
              data-testid={`alert-history-run-${run.engineRunId}`}
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", style.bg)}>
                <Icon className={cn("h-4 w-4", style.color, style.spin && "animate-spin")} />
              </span>
              <span className="min-w-0 flex-1">
                {/* The id is the fallback, not the default: it only shows while
                    the workflow definition has not reached Convex yet. */}
                <span className="block truncate text-sm font-medium">{run.workflowName ?? run.workflowId}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{formatTimeAgo(run.startedAt ?? run.engineCreatedAt)}</span>
                  {duration && (
                    <>
                      <span>·</span>
                      <span>{duration}</span>
                    </>
                  )}
                </span>
              </span>
              {run.triggeredBy && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {run.triggeredBy}
                </Badge>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
