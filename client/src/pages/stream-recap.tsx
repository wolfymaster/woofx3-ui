import { api } from "@convex/_generated/api";
import type { RecapSupporter, StreamRecapEngineDetail } from "@convex/lib/streamRecap";
import { useAction, useQuery } from "convex/react";
import { ArrowLeft, Copy, Gift, Loader2, MessageSquare, RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { EngineFeatureGate } from "@/components/engine/engine-feature-gate";
import { PageHeader } from "@/components/layout/page-header";
import { ClipsCard, TopClipTile } from "@/components/stream-recap/clips-card";
import { OpenSessionBadge } from "@/components/stream-recap/open-session-badge";
import { ViewerChart } from "@/components/stream-recap/viewer-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { useInstance } from "@/hooks/use-instance";
import { useOpenSessionRefresh } from "@/hooks/use-open-session-refresh";
import { useRecapClips } from "@/hooks/use-recap-clips";
import { type StreamRecapEngineState, useStreamRecapEngineDetail } from "@/hooks/use-stream-recap-engine-detail";
import { useToast } from "@/hooks/use-toast";
import { RECAP_ENGINE_CAPABILITIES } from "@/lib/engine-capabilities";
import {
  formatLiveDuration,
  formatViewerFigure,
  liveDurationMs,
  type SessionSummaryRow,
  summarySegments,
} from "@/lib/session-summary";
import { buildThankYouMessage, buildViewerSeries, segmentTimeline, type TimelineSegment } from "@/lib/stream-recap";
import { STREAM_RECAPS_PATH, sessionIdFromParam } from "@/lib/stream-recap-route";

const ANNOUNCEMENT_SCOPE = "moderator:manage:announcements";

const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

type SessionBody = {
  session: NonNullable<SessionSummaryRow["session"]>;
  totals: NonNullable<SessionSummaryRow["totals"]>;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, TIME_FORMAT);
}

function BackLink() {
  return (
    <Link
      href={STREAM_RECAPS_PATH}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      data-testid="link-recaps-back"
    >
      <ArrowLeft className="h-4 w-4" />
      All recaps
    </Link>
  );
}

function SegmentBar({ timeline }: { timeline: TimelineSegment[] }) {
  if (timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">This session never went live.</p>;
  }
  return (
    <div className="space-y-2" data-testid="recap-segments">
      <div className="relative h-3 rounded-full bg-muted" role="img" aria-label={`${timeline.length} live segments`}>
        {timeline.map((segment) => (
          <div
            key={segment.id}
            className="absolute inset-y-0 rounded-full bg-primary"
            style={{ left: `${segment.offsetPercent}%`, width: `max(${segment.widthPercent}%, 4px)` }}
            title={`${formatTime(segment.startedAt)} – ${segment.ongoing ? "now" : formatTime(segment.endedAt)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        {timeline.map((segment) => (
          <li key={segment.id}>
            {formatTime(segment.startedAt)} – {segment.ongoing ? "live" : formatTime(segment.endedAt)} (
            {formatLiveDuration(Date.parse(segment.endedAt) - Date.parse(segment.startedAt))})
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {detail && <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>}
    </Card>
  );
}

function TotalsGrid({ totals }: { totals: SessionBody["totals"] }) {
  const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3" data-testid="recap-totals">
      <StatTile label="Peak viewers" value={formatViewerFigure(totals.peakViewers)} />
      <StatTile
        label="Average viewers"
        value={formatViewerFigure(totals.averageViewers)}
        detail={
          totals.viewerSampleMinutes > 0 ? `over ${plural(totals.viewerSampleMinutes, "minute", "minutes")}` : undefined
        }
      />
      <StatTile label="Follows" value={totals.follows.toLocaleString()} />
      <StatTile label="Subs" value={totals.subs.toLocaleString()} detail="New and renewed" />
      <StatTile label="Gifted subs" value={totals.giftedSubs.toLocaleString()} />
      <StatTile label="Bits" value={totals.bits.toLocaleString()} detail={plural(totals.cheers, "cheer", "cheers")} />
      <StatTile
        label="Raids"
        value={totals.raids.toLocaleString()}
        detail={totals.raids > 0 ? plural(totals.raiders, "raider", "raiders") : undefined}
      />
    </div>
  );
}

interface EngineProblem {
  message: string;
  /** The engine's own error text, when it gave one. */
  errorText?: string;
  /** Whether trying again could help; a refusal or a missing session will not change on retry. */
  retryable: boolean;
}

function EngineNotice({ state, onRetry }: { state: StreamRecapEngineState; onRetry: () => void }) {
  if (state.kind === "loading") {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const problem = engineProblem(state);
  if (problem === null) {
    return null;
  }
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="recap-engine-notice">
      <WifiOff className="h-6 w-6 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground max-w-sm">{problem.message}</p>
      {problem.errorText && (
        <p
          className="max-w-sm break-words font-mono text-xs text-muted-foreground"
          data-testid="text-recap-engine-error"
        >
          {problem.errorText}
        </p>
      )}
      {problem.retryable && (
        <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-recap-retry">
          <RefreshCw className="h-4 w-4 mr-2" />
          Try again
        </Button>
      )}
    </div>
  );
}

function engineProblem(state: StreamRecapEngineState): EngineProblem | null {
  if (state.kind === "error") {
    return { message: "Couldn't load this from the engine.", errorText: state.message, retryable: true };
  }
  if (state.kind !== "loaded") {
    return null;
  }
  const detail = state.detail;
  switch (detail.status) {
    case "ok":
      return null;
    case "unregistered":
      return {
        message: "This instance isn't registered with an engine, so viewer history and supporters aren't available.",
        retryable: false,
      };
    case "unknown_session":
      return {
        message: "The engine no longer has this session. It may have been merged into another one.",
        retryable: false,
      };
    case "rejected":
      return {
        message: "The engine refused this dashboard's credentials. Register the engine again under Admin, Engine.",
        retryable: false,
      };
    case "unreachable":
      return {
        message: "The engine is offline or didn't answer, so viewer history and supporters can't be shown right now.",
        errorText: detail.message,
        retryable: true,
      };
    case "failed":
      return {
        message: "The engine couldn't load viewer history and supporters for this stream.",
        errorText: detail.message,
        retryable: true,
      };
  }
}

function okDetail(state: StreamRecapEngineState): Extract<StreamRecapEngineDetail, { status: "ok" }> | null {
  if (state.kind === "loaded" && state.detail.status === "ok") {
    return state.detail;
  }
  return null;
}

function SupporterList({
  title,
  icon: Icon,
  supporters,
  unit,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  supporters: RecapSupporter[];
  unit: (supporter: RecapSupporter) => string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </h3>
      {supporters.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody this stream.</p>
      ) : (
        <ol className="space-y-1">
          {supporters.map((supporter, index) => (
            <li key={supporter.platformUserId} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                <span className="text-muted-foreground tabular-nums mr-2">{index + 1}.</span>
                {supporter.userName ?? <span className="text-muted-foreground">Unknown viewer</span>}
              </span>
              <span className="tabular-nums text-muted-foreground shrink-0">{unit(supporter)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SupportersCard({
  instanceId,
  detail,
  canAnnounce,
}: {
  instanceId: SessionSummaryRow["instanceId"];
  detail: Extract<StreamRecapEngineDetail, { status: "ok" }>;
  canAnnounce: boolean;
}) {
  const { toast } = useToast();
  const sendAnnouncement = useAction(api.twitchBroadcast.sendAnnouncement);
  const [sending, setSending] = useState(false);
  const message = useMemo(
    () => buildThankYouMessage({ gifters: detail.topGifters, cheerers: detail.topCheerers }),
    [detail]
  );

  const handleCopy = async () => {
    if (message === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: "Thank-you message copied" });
    } catch {
      toast({ title: "Couldn't copy to the clipboard", variant: "destructive" });
    }
  };

  const handleSend = async () => {
    if (message === null) {
      return;
    }
    setSending(true);
    try {
      await sendAnnouncement({ instanceId, message, color: "primary" });
      toast({ title: "Sent to chat" });
    } catch (error) {
      toast({
        title: "Couldn't send to chat",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top supporters</CardTitle>
        <CardDescription>
          Who cheered and gifted the most this stream. Anonymous gifts and cheers aren't ranked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <SupporterList
            title="Gifted subs"
            icon={Gift}
            supporters={detail.topGifters}
            unit={(s) => (s.total === 1 ? "1 sub" : `${s.total.toLocaleString()} subs`)}
          />
          <SupporterList
            title="Bits"
            icon={Sparkles}
            supporters={detail.topCheerers}
            unit={(s) => `${s.total.toLocaleString()} bits`}
          />
        </div>
        {message !== null && (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="text-thank-you">
              {message}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy} data-testid="button-copy-thank-you">
                <Copy className="h-4 w-4 mr-2" />
                Copy thank-you message
              </Button>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!canAnnounce || sending}
                data-testid="button-send-thank-you"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4 mr-2" />
                )}
                Send to chat
              </Button>
              {!canAnnounce && (
                <span className="text-xs text-muted-foreground">
                  Connect Twitch with chat announcement access in Settings to send this to chat.
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecapBody({ row, sessionId }: { row: SessionSummaryRow; sessionId: string }) {
  const platformLinks = useQuery(api.instances.getPlatformLinks, { instanceId: row.instanceId });
  const capabilities = useEngineCapabilities(row.instanceId);
  const engineSupport = capabilities.support(...RECAP_ENGINE_CAPABILITIES);
  const inProgress = row.session?.status === "open";
  const { state, retry } = useStreamRecapEngineDetail(
    row.instanceId,
    sessionId,
    engineSupport === "supported",
    inProgress ? row.generatedAtMs : 0
  );
  const clips = useRecapClips(row.instanceId, sessionId);
  const body: SessionBody | null = row.session && row.totals ? { session: row.session, totals: row.totals } : null;
  const segments = useMemo(() => summarySegments(row), [row]);
  const detail = okDetail(state);
  const series = useMemo(() => buildViewerSeries(detail?.viewerSamples ?? [], segments), [detail, segments]);
  const timeline = useMemo(() => segmentTimeline(segments), [segments]);
  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  const canAnnounce = !!twitchLink?.scopes.includes(ANNOUNCEMENT_SCOPE);

  const title = body ? new Date(body.session.startedAt).toLocaleDateString(undefined, DATE_FORMAT) : "Stream recap";
  const description = body
    ? segments.length === 0
      ? "Never went live"
      : `Live ${formatLiveDuration(liveDurationMs(segments))}, from ${formatTime(body.session.startedAt)}`
    : `A summary from a newer engine version (schema ${row.schemaVersion}) that this dashboard cannot read yet.`;

  return (
    <div className="space-y-6">
      <div>
        <BackLink />
        <PageHeader
          title={title}
          description={description}
          className="pb-0"
          actions={
            <>
              <TopClipTile state={clips.state} />
              {body?.session.status === "open" && <OpenSessionBadge />}
            </>
          }
        />
      </div>

      {body && (
        <>
          <Card className="p-4">
            <SegmentBar timeline={timeline} />
          </Card>
          <TotalsGrid totals={body.totals} />
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Viewers</CardTitle>
          <CardDescription>Per minute while live. Gaps are minutes that weren't sampled.</CardDescription>
        </CardHeader>
        <CardContent>
          <EngineFeatureGate
            support={engineSupport}
            state={capabilities.state}
            feature="Viewer history and top supporters"
            onRetry={capabilities.refresh}
          >
            {detail ? <ViewerChart series={series} /> : <EngineNotice state={state} onRetry={retry} />}
          </EngineFeatureGate>
        </CardContent>
      </Card>

      {detail ? (
        <SupportersCard instanceId={row.instanceId} detail={detail} canAnnounce={canAnnounce} />
      ) : (
        engineSupport === "supported" &&
        state.kind === "loading" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top supporters</CardTitle>
            </CardHeader>
            <CardContent>
              <EngineNotice state={state} onRetry={retry} />
            </CardContent>
          </Card>
        )
      )}

      {body && (
        <ClipsCard instanceId={row.instanceId} state={clips.state} onReload={clips.reload} canAnnounce={canAnnounce} />
      )}
    </div>
  );
}

function RecapNotFound() {
  return (
    <div className="container mx-auto p-6">
      <BackLink />
      <div className="py-16 text-center" data-testid="recap-not-found">
        <p className="text-sm text-muted-foreground">
          There's no recap for this stream. A recap appears once the engine sends the stream's summary.
        </p>
      </div>
    </div>
  );
}

export default function StreamRecap() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = sessionIdFromParam(params.sessionId);
  const { instance, isLoading } = useInstance();
  useOpenSessionRefresh(instance?._id);
  const row = useQuery(
    api.streamSessionSummaries.get,
    instance && sessionId ? { instanceId: instance._id, sessionId } : "skip"
  );

  if (!isLoading && !instance) {
    return (
      <div className="container mx-auto p-6">
        <p className="py-16 text-center text-sm text-muted-foreground">No instance connected.</p>
      </div>
    );
  }
  if (sessionId === "" || row === null) {
    return <RecapNotFound />;
  }
  if (row === undefined) {
    return (
      <div className="container mx-auto p-6 flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="container mx-auto p-6">
      <RecapBody row={row} sessionId={sessionId} />
    </div>
  );
}
