import { Clock, Gamepad2, Gift, Heart, Radio, UserPlus, Users, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveState } from "@/hooks/use-live-state";
import type { PlatformEvent, PlatformEventType } from "@/lib/platforms/types";
import { usePlatformEvents } from "@/lib/platforms/use-platform-events";
import { formatUptime } from "@/lib/utils";

// Every number here comes from a path that already exists: the channel facts
// from the same `instanceLiveState` row the stream-status widget reads, and
// the tallies from the same direct-to-Twitch EventSub subscription the
// live-events widget uses (shared and ref-counted by usePlatformEvents, so
// this widget adds no second connection). Nothing is invented, and no third
// metrics table was added — the engine reports no running follower/sub/bits
// totals to read instead.

const EVENT_TYPES: PlatformEventType[] = ["follow", "subscribe", "cheer", "raid"];

interface SessionTallies {
  follows: number;
  subscribes: number;
  bits: number;
  raids: number;
}

const EMPTY_TALLIES: SessionTallies = { follows: 0, subscribes: 0, bits: 0, raids: 0 };

function StatRow({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function StreamStatsWidget() {
  const liveState = useLiveState();
  const [now, setNow] = useState(() => Date.now());
  const [tallies, setTallies] = useState<SessionTallies>(EMPTY_TALLIES);

  const isLive = liveState?.isLive ?? false;
  const startedAt = liveState?.startedAt;

  // A new broadcast is a new session — otherwise last stream's tallies linger
  // on a tab left open across a restart. Reset during render rather than in an
  // effect: there's no outside system to sync with, just state derived from a
  // changed input.
  const [talliedSession, setTalliedSession] = useState(startedAt);
  if (talliedSession !== startedAt) {
    setTalliedSession(startedAt);
    setTallies(EMPTY_TALLIES);
  }

  useEffect(() => {
    if (!isLive) {
      return;
    }
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  const handleEvent = useCallback((event: PlatformEvent) => {
    setTallies((prev) => {
      switch (event.type) {
        case "follow":
          return { ...prev, follows: prev.follows + 1 };
        case "subscribe":
          return { ...prev, subscribes: prev.subscribes + 1 };
        case "cheer":
          return { ...prev, bits: prev.bits + (event.amount ?? 0) };
        case "raid":
          return { ...prev, raids: prev.raids + 1 };
        default:
          return prev;
      }
    });
  }, []);

  usePlatformEvents(EVENT_TYPES, handleEvent);

  const uptime = useMemo(() => {
    if (!isLive || !startedAt) {
      return "—";
    }
    return formatUptime(startedAt, now);
  }, [isLive, startedAt, now]);

  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="shrink-0 px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Radio className={`h-4 w-4 ${isLive ? "text-red-500" : "text-muted-foreground"}`} />
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${isLive ? "text-red-500" : "text-muted-foreground"}`}
          >
            {isLive ? "Live" : "Offline"}
          </span>
        </div>
        {liveState?.streamTitle && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{liveState.streamTitle}</p>
        )}
      </div>

      <div className="divide-y divide-border">
        <StatRow icon={Users} label="Viewers" value={(liveState?.viewerCount ?? 0).toLocaleString()} />
        <StatRow icon={Clock} label="Uptime" value={uptime} />
        <StatRow icon={Gamepad2} label="Category" value={liveState?.gameName || "—"} />
      </div>

      <div className="shrink-0 px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Since this page loaded
      </div>
      <div className="divide-y divide-border">
        <StatRow icon={UserPlus} label="Follows" value={tallies.follows.toLocaleString()} />
        <StatRow icon={Heart} label="Subs" value={tallies.subscribes.toLocaleString()} />
        <StatRow icon={Gift} label="Bits" value={tallies.bits.toLocaleString()} />
        <StatRow icon={Zap} label="Raids" value={tallies.raids.toLocaleString()} />
      </div>
    </div>
  );
}
