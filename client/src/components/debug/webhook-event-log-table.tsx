import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { EngineEventType } from "@woofx3/api/webhooks";
import { useQuery } from "convex/react";
import { Clock, RotateCcw, Webhook } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { WebhookEventPayloadDialog } from "@/components/debug/webhook-event-payload-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInstance } from "@/hooks/use-instance";
import { useRetriggerEvent } from "@/hooks/use-retrigger-event";

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    const mins = Math.floor(diff / 60_000);
    return `${mins} min ago`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `${hours}h ago`;
  }
  if (diff < 604_800_000) {
    const days = Math.floor(diff / 86_400_000);
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function sourceBadgeVariant(source: string): "default" | "secondary" | "outline" {
  return source === "retrigger" ? "secondary" : "outline";
}

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Types" },
  ...Object.values(EngineEventType)
    .sort()
    .map((value) => ({ value, label: value })),
];

function EventLogTableSkeleton() {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Event Type</TableHead>
            <TableHead>Application</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Payload</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export function WebhookEventLogTable() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const [typeFilter, setTypeFilter] = useState("all");
  const [pendingIds, setPendingIds] = useState<Set<Id<"engineEventLog">>>(new Set());
  const retriggerEvent = useRetriggerEvent();

  const eventsRaw = useQuery(
    api.engineEventLog.list,
    instance ? { instanceId: instance._id, ...(typeFilter !== "all" ? { eventType: typeFilter } : {}) } : "skip"
  );

  const events = eventsRaw ?? [];
  const isLoading = instanceLoading || eventsRaw === undefined;

  const handleRetrigger = async (logId: Id<"engineEventLog">, eventType: string) => {
    setPendingIds((prev) => new Set(prev).add(logId));
    try {
      await retriggerEvent(logId, eventType);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(logId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            {EVENT_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isLoading && (
          <div className="text-sm text-muted-foreground">
            {events.length} event{events.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {isLoading ? (
        <EventLogTableSkeleton />
      ) : events.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No events logged"
          description={
            typeFilter !== "all"
              ? "Try a different event type filter."
              : "Events received from the engine will appear here as they arrive."
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event Type</TableHead>
                <TableHead>Application</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Payload</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event._id}>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span title={formatAbsoluteTime(event.receivedAt)}>{formatRelativeTime(event.receivedAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {event.eventType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{event.applicationId ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={sourceBadgeVariant(event.source)} className="capitalize">
                      {event.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <WebhookEventPayloadDialog eventType={event.eventType} payload={event.payload} />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => handleRetrigger(event._id, event.eventType)}
                      disabled={pendingIds.has(event._id)}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                      title="Retrigger event"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {pendingIds.has(event._id) ? "Retriggering…" : "Retrigger"}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
