import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { Clock, Radio, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useInstance } from "@/hooks/use-instance";
import { formatUptime } from "@/lib/utils";

export function StreamStatusWidget() {
  const { instance } = useInstance();
  const liveState = useQuery(api.instanceLiveState.getForInstance, instance ? { instanceId: instance._id } : "skip");
  const pollLiveState = useAction(api.streamStatus.pollLiveState);
  const [now, setNow] = useState(() => Date.now());

  const isLive = liveState?.isLive ?? false;

  // instanceLiveState is kept fresh by STREAM_ONLINE/OFFLINE webhook pushes and
  // the "stream live state sweep" cron (convex/crons.ts); this one-shot poll on
  // mount just gets instant freshness rather than waiting for the next tick.
  useEffect(() => {
    if (!instance) {
      return;
    }
    void pollLiveState({ instanceId: instance._id });
  }, [instance, pollLiveState]);

  useEffect(() => {
    if (!isLive) {
      return;
    }
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  const uptime = useMemo(() => {
    if (!isLive || !liveState?.startedAt) {
      return "00:00:00";
    }
    return formatUptime(liveState.startedAt, now);
  }, [isLive, liveState?.startedAt, now]);
  const viewerCount = liveState?.viewerCount ?? 0;

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center gap-2">
        <Radio className={`h-5 w-5 ${isLive ? "text-red-500" : "text-muted-foreground"}`} />
        <span className={`text-sm font-medium ${isLive ? "text-red-500" : "text-muted-foreground"}`}>
          {isLive ? "LIVE" : "OFFLINE"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{viewerCount.toLocaleString()} viewers</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{uptime}</span>
        </div>
      </div>
      {!isLive && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Stream is offline</div>
      )}
    </div>
  );
}
