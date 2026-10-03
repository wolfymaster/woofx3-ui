import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { ChevronRight, History, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { OpenSessionBadge } from "@/components/stream-recap/open-session-badge";
import { Card } from "@/components/ui/card";
import { useInstance } from "@/hooks/use-instance";
import { useOpenSessionRefresh } from "@/hooks/use-open-session-refresh";
import {
  formatLiveDuration,
  formatSubsBreakdown,
  formatViewerFigure,
  liveDurationMs,
  type SessionSummaryRow,
  summarySegments,
} from "@/lib/session-summary";
import { streamRecapPath } from "@/lib/stream-recap-route";

/** The most the summary listing returns in one read. */
const RECAP_LIST_LIMIT = 50;

const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" };

function RecapRow({ row }: { row: SessionSummaryRow }) {
  const { session, totals } = row;
  const heading = session
    ? new Date(session.startedAt).toLocaleDateString(undefined, DATE_FORMAT)
    : "Unreadable summary";
  const subheading = session
    ? session.segments.length === 0
      ? "Never went live"
      : `Live ${formatLiveDuration(liveDurationMs(summarySegments(row)))}`
    : `Schema ${row.schemaVersion}`;

  return (
    <Link
      href={streamRecapPath(row.sessionId)}
      className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
      data-testid={`link-recap-${row.sessionId}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {heading}
          {session?.status === "open" && <OpenSessionBadge />}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">{subheading}</div>
      </div>
      {totals && (
        <div className="hidden sm:flex gap-6 text-right text-xs text-muted-foreground tabular-nums">
          <span>Peak {formatViewerFigure(totals.peakViewers)}</span>
          <span>{totals.follows.toLocaleString()} follows</span>
          <span>{formatSubsBreakdown(totals.subs, totals.giftedSubs)}</span>
          <span>{totals.bits.toLocaleString()} bits</span>
        </div>
      )}
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

export default function StreamRecaps() {
  const { instance, isLoading } = useInstance();
  useOpenSessionRefresh(instance?._id);
  const rows = useQuery(
    api.streamSessionSummaries.listRecent,
    instance ? { instanceId: instance._id, limit: RECAP_LIST_LIMIT } : "skip"
  );

  let content: React.ReactNode;
  if (!isLoading && !instance) {
    content = <p className="py-16 text-center text-sm text-muted-foreground">No instance connected.</p>;
  } else if (rows === undefined) {
    content = (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (rows.length === 0) {
    content = (
      <div className="py-16 text-center" data-testid="recaps-empty">
        <History className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No stream recaps yet. A stream's recap appears once the next one starts.
        </p>
      </div>
    );
  } else {
    content = (
      <Card className="divide-y divide-border overflow-hidden">
        {rows.map((row) => (
          <RecapRow key={row._id} row={row} />
        ))}
      </Card>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="Stream recaps"
        description="How each stream went: viewers, follows, subs, bits and raids, and who supported you most."
      />
      {content}
    </div>
  );
}
