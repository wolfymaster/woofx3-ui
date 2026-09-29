import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EngineEventType } from "@woofx3/api/webhooks";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Clock, RotateCcw, Webhook } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
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
            <TableHead>Source</TableHead>
            <TableHead>Payload</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholder; the list never reorders
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-32" />
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

const PAGE_SIZE = 50;
const ESTIMATED_ROW_HEIGHT = 57;
const OVERSCAN_ROWS = 10;
// Start fetching the next page while this many loaded rows remain below the viewport.
const LOAD_MORE_THRESHOLD_ROWS = 10;

type EventLogSummary = FunctionReturnType<typeof api.engineEventLog.list>["page"][number];

function formatPayloadSize(length: number): string {
  if (length < 1024) {
    return `${length} B`;
  }
  return `${(length / 1024).toFixed(1)} KB`;
}

interface EventRowProps {
  event: EventLogSummary;
  index: number;
  isPending: boolean;
  measureRef: (element: HTMLTableRowElement | null) => void;
  onRetrigger: (logId: Id<"engineEventLog">, eventType: string) => void;
}

const EventRow = memo(function EventRow({ event, index, isPending, measureRef, onRetrigger }: EventRowProps) {
  return (
    <TableRow ref={measureRef} data-index={index}>
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
      <TableCell>
        <Badge variant={sourceBadgeVariant(event.source)} className="capitalize">
          {event.source}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <WebhookEventPayloadDialog logId={event._id} eventType={event.eventType} />
        <span className="ml-1 text-xs text-muted-foreground">{formatPayloadSize(event.payloadLength)}</span>
      </TableCell>
      <TableCell>
        <button
          type="button"
          onClick={() => onRetrigger(event._id, event.eventType)}
          disabled={isPending}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
          title="Retrigger event"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {isPending ? "Retriggering…" : "Retrigger"}
        </button>
      </TableCell>
    </TableRow>
  );
});

export function WebhookEventLogTable() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const [typeFilter, setTypeFilter] = useState("all");
  const [pendingIds, setPendingIds] = useState<Set<Id<"engineEventLog">>>(new Set());
  const retriggerEvent = useRetriggerEvent();
  const retriggerEventRef = useRef(retriggerEvent);
  retriggerEventRef.current = retriggerEvent;
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    results: events,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.engineEventLog.list,
    instance ? { instanceId: instance._id, ...(typeFilter !== "all" ? { eventType: typeFilter } : {}) } : "skip",
    { initialNumItems: PAGE_SIZE }
  );

  const isLoading = instanceLoading || status === "LoadingFirstPage";

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].index : -1;

  useEffect(() => {
    if (status === "CanLoadMore" && lastVisibleIndex >= events.length - LOAD_MORE_THRESHOLD_ROWS) {
      loadMore(PAGE_SIZE);
    }
  }, [status, lastVisibleIndex, events.length, loadMore]);

  const handleRetrigger = useCallback(async (logId: Id<"engineEventLog">, eventType: string) => {
    setPendingIds((prev) => new Set(prev).add(logId));
    try {
      await retriggerEventRef.current(logId, eventType);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(logId);
        return next;
      });
    }
  }, []);

  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;
  const hasMore = status !== "Exhausted";

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
            {events.length}
            {hasMore ? "+" : ""} event{events.length !== 1 || hasMore ? "s" : ""}
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
          {/*
            A plain <table> rather than the Table component: Table wraps itself in its
            own overflow container, which would capture the sticky header and hide the
            real scroll element from the virtualizer.
          */}
          <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Payload</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paddingTop > 0 && (
                  <tr>
                    <td colSpan={5} style={{ height: paddingTop }} />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const event = events[virtualRow.index];
                  return (
                    <EventRow
                      key={event._id}
                      event={event}
                      index={virtualRow.index}
                      isPending={pendingIds.has(event._id)}
                      measureRef={virtualizer.measureElement}
                      onRetrigger={handleRetrigger}
                    />
                  );
                })}
                {paddingBottom > 0 && (
                  <tr>
                    <td colSpan={5} style={{ height: paddingBottom }} />
                  </tr>
                )}
              </TableBody>
            </table>
            {status === "LoadingMore" && (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading more events…</div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
