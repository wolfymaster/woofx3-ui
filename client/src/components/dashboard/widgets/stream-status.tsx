import { Clock, Radio, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLiveState } from "@/hooks/use-live-state";
import { formatUptime } from "@/lib/utils";

export function StreamStatusWidget() {
  const liveState = useLiveState();
  const [now, setNow] = useState(() => Date.now());

  const isLive = liveState?.isLive ?? false;

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
