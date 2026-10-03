import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { History, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { OpenSessionBadge } from "@/components/stream-recap/open-session-badge";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstance } from "@/hooks/use-instance";
import { useOpenSessionRefresh } from "@/hooks/use-open-session-refresh";
import {
  formatLiveDuration,
  formatViewerFigure,
  liveDurationMs,
  type SessionSummaryRow,
  summarySegments,
} from "@/lib/session-summary";
import { streamRecapPath } from "@/lib/stream-recap-route";

const RECENT_STREAM_LIMIT = 10;

const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function RecentStreamItem({ row }: { row: SessionSummaryRow }) {
  if (!row.session || !row.totals) {
    return (
      <div className="px-3 py-2.5 text-xs text-muted-foreground" data-testid={`recent-stream-${row._id}`}>
        A summary from a newer engine version (schema {row.schemaVersion}) that this dashboard cannot read yet.
      </div>
    );
  }

  const { session, totals } = row;
  const liveMs = liveDurationMs(summarySegments(row));
  const startedOn = new Date(session.startedAt).toLocaleDateString(undefined, DATE_FORMAT);

  return (
    <Link
      href={streamRecapPath(row.sessionId)}
      className="block px-3 py-2.5 space-y-2 hover:bg-muted/50 transition-colors"
      data-testid={`recent-stream-${row._id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {startedOn}
          {session.status === "open" && <OpenSessionBadge />}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {session.segments.length === 0 ? "Never went live" : `Live ${formatLiveDuration(liveMs)}`}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
        <Figure label="Peak" value={formatViewerFigure(totals.peakViewers)} />
        <Figure label="Avg" value={formatViewerFigure(totals.averageViewers)} />
        <Figure label="Follows" value={totals.follows.toLocaleString()} />
        <Figure label="Subs" value={totals.subs.toLocaleString()} />
        <Figure label="Gifted" value={totals.giftedSubs.toLocaleString()} />
        <Figure label="Bits" value={totals.bits.toLocaleString()} />
      </div>
      {totals.raids > 0 && (
        <p className="text-xs text-muted-foreground">
          {totals.raids === 1 ? "1 raid" : `${totals.raids} raids`}, {totals.raiders.toLocaleString()} raiders
        </p>
      )}
    </Link>
  );
}

export function RecentStreamsWidget() {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  useOpenSessionRefresh(instanceId);
  const rows = useQuery(
    api.streamSessionSummaries.listRecent,
    instanceId ? { instanceId, limit: RECENT_STREAM_LIMIT } : "skip"
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <Badge variant="secondary" className="text-xs">
          Last {rows?.length ?? 0} {rows?.length === 1 ? "stream" : "streams"}
        </Badge>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {rows === undefined ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 px-3 text-center">
            <History className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              {instance
                ? "No finished streams yet. A stream shows up here once the next one starts."
                : "No instance connected"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <RecentStreamItem key={row._id} row={row} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
