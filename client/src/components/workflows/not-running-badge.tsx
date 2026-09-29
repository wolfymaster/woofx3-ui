import { AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  NO_REASON_GIVEN,
  NOT_RUNNING_EXPLANATION,
  NOT_RUNNING_LABEL,
  type NotRunningWorkflow,
} from "@/lib/workflow-health";

/**
 * A red badge for a workflow the engine refused to set up, opening onto the
 * engine's reason. A button so it works by tap as well as by pointer; clicks
 * stop here so a badge inside a clickable row does not also open the row.
 */
export function NotRunningBadge({ health, className }: { health: NotRunningWorkflow; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            className
          )}
          data-testid={`badge-not-running-${health.engineWorkflowId}`}
        >
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {NOT_RUNNING_LABEL}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium">{NOT_RUNNING_EXPLANATION}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{health.reason ?? NO_REASON_GIVEN}</p>
      </PopoverContent>
    </Popover>
  );
}
