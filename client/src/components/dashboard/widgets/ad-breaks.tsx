import { api } from "@convex/_generated/api";
import { AD_BREAK_EVENTS, ENGINE_TOO_OLD_FOR_ADS } from "@convex/lib/adBreaks";
import { useStore } from "@nanostores/react";
import { useAction } from "convex/react";
import { AlarmClockOff, Loader2, Megaphone } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/hooks/use-instance";
import { useLiveState } from "@/hooks/use-live-state";
import { useTwitchIntegration } from "@/hooks/use-twitch-integration";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { actionErrorMessage } from "@/lib/action-error";
import {
  type AdBreakView,
  type AdScheduleFetch,
  adBreakView,
  applySnooze,
  countdownExpired,
  formatAgo,
  formatCountdown,
  type RunningAd,
  runningAdFromBegin,
  scheduleFetch,
} from "@/lib/ad-break-view";
import { $nowPerSecond } from "@/lib/now";
import { transport } from "@/lib/transport";

/**
 * Twitch pushes nothing to the browser about the schedule itself, and a
 * snooze from Twitch's own dashboard changes it, so it is polled. Ad events
 * from the engine, when it forwards them, only make the running state and
 * the refresh after an ad immediate.
 */
const SCHEDULE_REFRESH_MS = 60_000;

const AD_SCOPES = ["channel:read:ads", "channel:manage:ads"];

export function AdBreaksWidget() {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const liveState = useLiveState();
  const { twitchLink, isLoading: linksLoading } = useTwitchIntegration(instanceId);
  const getSchedule = useAction(api.adBreaks.getSchedule);
  const snoozeNextAd = useAction(api.adBreaks.snoozeNextAd);
  const now = useStore($nowPerSecond);

  const [fetchState, setFetchState] = useState<AdScheduleFetch>({ status: "loading" });
  const [running, setRunning] = useState<RunningAd | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [snoozeError, setSnoozeError] = useState<string | null>(null);
  const loaded = useRef(false);
  // Only the newest schedule request may land: an answer started before a
  // snooze, or before the widget went inactive, would put back what is stale.
  const latestRequest = useRef(0);
  const previousView = useRef<AdBreakView | null>(null);

  const live = liveState === undefined || linksLoading ? undefined : liveState?.isLive === true;
  const scopeGranted = !!twitchLink && AD_SCOPES.every((scope) => twitchLink.scopes.includes(scope));
  const active = live === true && scopeGranted && !!instanceId;

  const refresh = useCallback(() => {
    if (!instanceId) {
      return;
    }
    latestRequest.current += 1;
    const request = latestRequest.current;
    getSchedule({ instanceId })
      .then((result) => {
        if (request !== latestRequest.current) {
          return;
        }
        loaded.current = true;
        setFetchState(scheduleFetch(result, Date.now()));
      })
      .catch((err: unknown) => {
        // A failed poll keeps the last schedule; only a failed first read is shown.
        if (request === latestRequest.current && !loaded.current) {
          setFetchState({ status: "error", message: actionErrorMessage(err) });
        }
      });
  }, [instanceId, getSchedule]);

  useEffect(() => {
    if (!active) {
      latestRequest.current += 1;
      loaded.current = false;
      setFetchState({ status: "loading" });
      setRunning(null);
      return;
    }
    refresh();
  }, [active, refresh]);
  useVisibleInterval(refresh, SCHEDULE_REFRESH_MS, active);

  useEffect(() => {
    if (!active || !instanceId) {
      return;
    }
    return transport.subscribeStreamEvents(instanceId, (frame) => {
      if (frame.type === AD_BREAK_EVENTS.begin) {
        setRunning(runningAdFromBegin(frame.data, Date.now()));
      } else if (frame.type === AD_BREAK_EVENTS.end) {
        setRunning(null);
        refresh();
      } else if (frame.type === AD_BREAK_EVENTS.upcoming) {
        refresh();
      }
    });
  }, [active, instanceId, refresh]);

  const snooze = async () => {
    if (!instanceId) {
      return;
    }
    setSnoozing(true);
    setSnoozeError(null);
    try {
      const result = await snoozeNextAd({ instanceId });
      latestRequest.current += 1;
      const receivedAt = Date.now();
      setFetchState((current) => applySnooze(current, result, receivedAt));
    } catch (err) {
      setSnoozeError(actionErrorMessage(err));
    } finally {
      setSnoozing(false);
    }
  };

  const view = adBreakView({ live, scopeGranted, fetch: fetchState, running, now });

  // Runs after every render (the view is a new object each tick), comparing
  // against the last committed view rather than one from a discarded render.
  useEffect(() => {
    if (countdownExpired(previousView.current, view)) {
      refresh();
    }
    previousView.current = view;
  }, [view, refresh]);

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-testid="ad-breaks-widget">
      <AdBreakBody view={view} snoozing={snoozing} onSnooze={() => void snooze()} />
      {snoozeError && <p className="text-xs text-destructive">{snoozeError}</p>}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      <Megaphone className="h-8 w-8 text-muted-foreground/50" />
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function AdBreakBody({ view, snoozing, onSnooze }: { view: AdBreakView; snoozing: boolean; onSnooze: () => void }) {
  switch (view.kind) {
    case "loading":
      return (
        <Notice>
          <Loader2 className="h-4 w-4 animate-spin" />
        </Notice>
      );
    case "offline":
      return <Notice>Ad breaks show here while you are live.</Notice>;
    case "scopeMissing":
      return (
        <Notice>
          <span>Twitch has not granted access to your ad schedule.</span>
          <Link href="/admin/integrations" className="text-primary underline-offset-2 hover:underline">
            Reconnect Twitch
          </Link>
        </Notice>
      );
    case "engineOutdated":
      return <Notice>{ENGINE_TOO_OLD_FOR_ADS}</Notice>;
    case "unregistered":
      return <Notice>This instance is not registered with an engine.</Notice>;
    case "error":
      return <Notice>{view.message}</Notice>;
    case "running":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center" data-testid="ad-running">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Ad running</span>
          <span className="text-2xl font-semibold tabular-nums">Back in {formatCountdown(view.secondsLeft)}</span>
        </div>
      );
    case "scheduled":
      return (
        <>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Next ad</span>
            <span className="text-2xl font-semibold tabular-nums" data-testid="next-ad-countdown">
              {view.secondsUntilNext === null
                ? "None scheduled"
                : view.secondsUntilNext === 0
                  ? "Any moment"
                  : formatCountdown(view.secondsUntilNext)}
            </span>
            <span className="text-xs text-muted-foreground">{formatCountdown(view.durationSeconds)} long</span>
          </div>
          <div className="space-y-1">
            <Row label="Last ad">{view.secondsSinceLast === null ? "None yet" : formatAgo(view.secondsSinceLast)}</Row>
            <Row label="Preroll-free">
              {view.prerollFreeSeconds > 0 ? formatCountdown(view.prerollFreeSeconds) : "None left"}
            </Row>
            <Row label="Snoozes left">
              {view.snoozeCount}
              {view.secondsUntilSnoozeRefresh !== null && ` (+1 in ${formatCountdown(view.secondsUntilSnoozeRefresh)})`}
            </Row>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-auto"
            disabled={snoozing || view.snoozeCount === 0 || view.secondsUntilNext === null}
            onClick={onSnooze}
            data-testid="button-snooze-ad"
          >
            {snoozing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <AlarmClockOff className="mr-1.5 h-3.5 w-3.5" />
            )}
            Snooze next ad ({view.snoozeCount} left)
          </Button>
        </>
      );
  }
}
