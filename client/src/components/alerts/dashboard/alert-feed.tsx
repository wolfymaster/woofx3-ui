import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { BellRing, Loader2, RotateCcw, ScrollText } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { alertEventType, alertTarget } from "@/lib/alert-envelope";
import { describeAlertFailure } from "@/lib/alert-failure";
import { alertRunPath } from "@/lib/alert-run-route";
import { alertStatusStyle } from "@/lib/alert-status";
import { formatTimeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

interface AlertFeedProps {
  instanceId: Id<"instances">;
  alerts: Doc<"engineAlerts">[];
  /** CloudEvent type → the trigger's own name, so a row reads "Follow", not "channel.follow". */
  eventNames: Map<string, string>;
}

/** Recent dispatches, newest first, each replayable. */
export function AlertFeed({ instanceId, alerts, eventNames }: AlertFeedProps) {
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
        <AlertFeedRow key={alert._id} instanceId={instanceId} alert={alert} eventNames={eventNames} />
      ))}
    </ul>
  );
}

interface AlertFeedRowProps {
  instanceId: Id<"instances">;
  alert: Doc<"engineAlerts">;
  eventNames: Map<string, string>;
}

function AlertFeedRow({ instanceId, alert, eventNames }: AlertFeedRowProps) {
  const replay = useAction(api.alertActions.replay);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const style = alertStatusStyle(alert.status);
  const StatusIcon = style.icon;
  const target = alertTarget(alert.payload);
  const event = alertEventType(alert.payload);
  const title = (event ? (eventNames.get(event) ?? event) : null) ?? (target ? `Alert → ${target}` : "Alert");
  const failure = alert.error ? describeAlertFailure(alert.error) : null;

  const start = async () => {
    setBusy(true);
    try {
      const { replayed } = await replay({ instanceId, engineAlertId: alert.engineAlertId });
      if (replayed) {
        // The new dispatch and this row's `replayed` status both arrive as
        // webhooks, so the list updates itself; the toast only confirms that
        // the engine took the request.
        toast({ title: "Replaying", description: "The engine re-published this alert." });
      } else {
        toast({
          variant: "destructive",
          title: "Nothing to replay",
          description: "The engine no longer has this alert, or its stored payload cannot be read.",
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Replay could not be started",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="group flex items-start gap-3 px-3 py-2.5" data-testid={`alert-feed-${alert._id}`}>
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md", style.bg)}>
        <StatusIcon className={cn("h-4 w-4", style.color)} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
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
          <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="Open the run that fired this">
            <Link href={alertRunPath(alert.workflowId)}>
              <ScrollText className="h-3.5 w-3.5" />
              <span className="sr-only">Open the run that fired this</span>
            </Link>
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={busy}
          onClick={() => void start()}
          title="Play this alert again"
          data-testid={`button-replay-alert-${alert._id}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          <span className="sr-only">Play this alert again</span>
        </Button>
      </div>
    </li>
  );
}
