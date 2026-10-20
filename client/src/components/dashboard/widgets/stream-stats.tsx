import { Clock, Gamepad2, Gift, HandHeart, Heart, Radio, UserPlus, Users, Zap } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Uptime } from "@/components/common/uptime";
import { useLiveState } from "@/engine/hooks/use-live-state";
import { useInstance } from "@/hooks/use-instance";
import { EMPTY_TALLIES, STREAM_TALLY_EVENTS, type StreamTallies, tallyStreamEvent } from "@/lib/stream-tallies";
import { transport } from "@/lib/transport";

// Every number here comes from a path that already exists: the channel facts
// from the same `instanceLiveState` row the stream-status widget reads, and
// the tallies from the engine's stream-event push (one engine subscription the
// transport fans out, so this widget adds no second connection). Nothing is
// invented, and no third metrics table was added — the engine reports no
// running follower/sub/bits totals to read instead.

function StatRow({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: ReactNode }) {
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
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const liveState = useLiveState();
  const [tallies, setTallies] = useState<StreamTallies>(EMPTY_TALLIES);

  const isLive = liveState?.isLive ?? false;
  const startedAt = liveState?.startedAt;
  const sessionId = liveState?.sessionId;

  // Tallies belong to the session, not the broadcast: keying this on startedAt
  // meant a thirty-second dropout reset the counts mid-stream, because
  // reconnecting mints a new start. Reset during render rather than in an
  // effect — there's no outside system to sync with, just state derived from a
  // changed input.
  const [talliedSession, setTalliedSession] = useState(sessionId);
  if (talliedSession !== sessionId) {
    setTalliedSession(sessionId);
    setTallies(EMPTY_TALLIES);
  }

  useEffect(() => {
    if (!instanceId) {
      return;
    }
    return transport.subscribeStreamEvents(instanceId, STREAM_TALLY_EVENTS, (frame) => {
      setTallies((previous) => tallyStreamEvent(previous, frame));
    });
  }, [instanceId]);

  const uptime = isLive && startedAt ? <Uptime startedAt={startedAt} /> : "—";

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
        <StatRow icon={HandHeart} label="Gifted subs" value={tallies.giftedSubs.toLocaleString()} />
        <StatRow icon={Gift} label="Bits" value={tallies.bits.toLocaleString()} />
        <StatRow icon={Zap} label="Raids" value={tallies.raids.toLocaleString()} />
      </div>
    </div>
  );
}
