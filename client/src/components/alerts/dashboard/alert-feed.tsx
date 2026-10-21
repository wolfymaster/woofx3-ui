import { BellRing, Loader2, RotateCcw, ScrollText } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReplayAlert } from "@/engine/hooks/use-replay-alert";
import type { EngineAlert } from "@/engine/types";
import { useDescribeAlert } from "@/hooks/use-describe-alert";
import { alertTarget } from "@/lib/alert-envelope";
import { describeAlertFailure } from "@/lib/alert-failure";
import { alertRunPath } from "@/lib/alert-run-route";
import { engineAlertStyle } from "@/lib/alert-status";
import type { AlertSummary } from "@/lib/alert-summary";
import { formatTimeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

interface AlertFeedProps {
  alerts: EngineAlert[];
}

/** Recent dispatches, newest first, each replayable. */
export function AlertFeed({ alerts }: AlertFeedProps) {
  const describe = useDescribeAlert();
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-12 text-center" data-testid="alert-feed-empty">
        <BellRing className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No alerts have fired yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Fire a test event to check an overlay without waiting for a viewer.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="alert-feed">
      {alerts.map((alert) => (
        <AlertFeedRow key={alert.id} alert={alert} summary={describe(alert.payload)} />
      ))}
    </ul>
  );
}

interface AlertFeedRowProps {
  alert: EngineAlert;
  /** Who did what, e.g. "wolfy_fan redeemed Hydrate", and the facts worth a glance. */
  summary: AlertSummary;
}

function AlertFeedRow({ alert, summary }: AlertFeedRowProps) {
  const { replay, busy } = useReplayAlert();

  const style = engineAlertStyle(alert);
  const StatusIcon = style.icon;
  const target = alertTarget(alert.payload);
  const failure = alert.error ? describeAlertFailure(alert.error) : null;

  return (
    <li className="group flex items-start gap-3 px-3 py-2.5" data-testid={`alert-feed-${alert.id}`}>
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md", style.bg)}>
        <StatusIcon className={cn("h-4 w-4", style.color)} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={summary.title}>
          {summary.title}
        </p>
        {summary.details.length > 0 && (
          <p className="truncate text-xs text-foreground/80" title={summary.details.join("\n")}>
            {summary.details.join(" · ")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{formatTimeAgo(alert.engineCreatedAt)}</span>
          {target && (
            <>
              <span>·</span>
              <span className="truncate">→ {target}</span>
            </>
          )}
        </div>
        {/* The readable title on the row; the advice and the original
            technical reason both on hover. Falls back to the raw reason for a
            failure the mapping does not know. */}
        {alert.error && (
          <p
            className={cn("mt-0.5 truncate text-xs", style.color)}
            title={[failure?.hint, alert.error].filter(Boolean).join("\n\n")}
          >
            {failure?.title ?? alert.error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Badge variant="secondary" className={cn("text-[10px]", style.color)}>
          {style.label}
        </Badge>
        {/* `workflowId` on an alert row is the execution that fired it, which is
            what a run is keyed on. Absent for a manual dispatch. */}
        {alert.workflowId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild size="icon" variant="ghost" className="h-7 w-7">
                <Link href={alertRunPath(alert.workflowId)}>
                  <ScrollText className="h-3.5 w-3.5" />
                  <span className="sr-only">Open the run that fired this</span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open the run that fired this</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              disabled={busy}
              onClick={() => void replay(alert.engineAlertId)}
              data-testid={`button-replay-alert-${alert.id}`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              <span className="sr-only">Play this alert again</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Play this alert again</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}
