import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { BellRing, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstance } from "@/hooks/use-instance";
import { alertTarget } from "@/lib/alert-envelope";
import { describeAlertFailure } from "@/lib/alert-failure";
import { alertStatusStyle, isFailureStatus } from "@/lib/alert-status";
import { formatTimeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

const ALERT_LIMIT = 30;

interface AlertRow {
  _id: string;
  status: string;
  error?: string;
  payload: string;
  engineCreatedAt: string;
}

function AlertLogItem({ alert }: { alert: AlertRow }) {
  const config = alertStatusStyle(alert.status);
  const StatusIcon = config.icon;
  const target = alertTarget(alert.payload);
  const friendly = alert.error ? describeAlertFailure(alert.error) : null;

  return (
    <div
      className="flex items-start gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors"
      data-testid={`alert-log-${alert._id}`}
    >
      <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0 mt-0.5", config.bg)}>
        <StatusIcon className={cn("h-4 w-4", config.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{target ? `Alert → ${target}` : "Alert"}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatTimeAgo(alert.engineCreatedAt)}</span>
        </div>
        {/* The readable title on the row; the advice and the original
            technical reason both on hover. Keeps the row one line without
            hiding anything — and falls back to the raw reason for a failure
            the mapping does not know. */}
        {alert.error && (
          <p
            className={cn("text-xs truncate mt-0.5", config.color)}
            title={[friendly?.hint, alert.error].filter(Boolean).join("\n\n")}
          >
            {friendly?.title ?? alert.error}
          </p>
        )}
      </div>
      <Badge variant="secondary" className={cn("text-[10px] shrink-0", config.color)}>
        {config.label}
      </Badge>
    </div>
  );
}

export function AlertLogWidget() {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const alerts = useQuery(api.engineAlerts.listForInstance, instanceId ? { instanceId, limit: ALERT_LIMIT } : "skip");

  const failures = alerts?.filter((alert) => isFailureStatus(alert.status)).length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <Badge variant="secondary" className="text-xs">
          {alerts?.length ?? 0} recent
        </Badge>
        {failures > 0 && (
          <Badge variant="secondary" className="text-xs text-red-500">
            {failures} failed
          </Badge>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {alerts === undefined ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="py-8 text-center">
              <BellRing className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                {instance ? "No alerts sent yet" : "No instance connected"}
              </p>
            </div>
          ) : (
            alerts.map((alert) => <AlertLogItem key={alert._id} alert={alert} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
