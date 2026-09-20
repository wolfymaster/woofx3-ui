import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { AlertCircle, BellRing, CheckCircle2, Loader2, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstance } from "@/hooks/use-instance";
import { describeAlertFailure } from "@/lib/alert-failure";
import { cn } from "@/lib/utils";

const ALERT_LIMIT = 30;

function formatTimeAgo(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return "";
  }
  const seconds = Math.floor((Date.now() - parsed) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const statusConfig: Record<string, { icon: typeof Loader2; color: string; bg: string; label: string }> = {
  sent: { icon: Loader2, color: "text-blue-400", bg: "bg-blue-400/10", label: "Sent" },
  pending: { icon: Loader2, color: "text-blue-400", bg: "bg-blue-400/10", label: "Pending" },
  dispatched: { icon: Loader2, color: "text-blue-400", bg: "bg-blue-400/10", label: "Dispatched" },
  playing: { icon: BellRing, color: "text-blue-500", bg: "bg-blue-500/10", label: "Playing" },
  completed: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", label: "Played" },
  replayed: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", label: "Replayed" },
  failed: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10", label: "Failed" },
  timed_out: { icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-500/10", label: "Timed out" },
  skipped: { icon: SkipForward, color: "text-gray-500", bg: "bg-gray-500/10", label: "Skipped" },
};

/**
 * The alert widget a dispatch was aimed at, read back out of the stored
 * envelope.
 *
 * Parsed defensively and allowed to fail: the payload is engine-authored JSON
 * the UI has never validated, and a name is a nicety. The target matters most
 * on the failure it cannot explain on its own — "no alert widget named X on a
 * running scene" reads very differently once you can see which X was meant.
 */
function alertTarget(payload: string): string | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const parameters = (parsed as { parameters?: unknown }).parameters;
    if (!parameters || typeof parameters !== "object") {
      return null;
    }
    const target = (parameters as { target?: unknown }).target;
    return typeof target === "string" && target.length > 0 ? target : null;
  } catch {
    return null;
  }
}

interface AlertRow {
  _id: string;
  status: string;
  error?: string;
  payload: string;
  engineCreatedAt: string;
}

function AlertLogItem({ alert }: { alert: AlertRow }) {
  const config = statusConfig[alert.status] ?? statusConfig.sent;
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

  const failures = alerts?.filter((alert) => alert.status === "failed").length ?? 0;

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
