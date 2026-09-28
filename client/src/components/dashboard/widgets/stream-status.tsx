import { Clock, Radio, Users } from "lucide-react";
import { Uptime } from "@/components/common/uptime";
import { useLiveState } from "@/hooks/use-live-state";

export function StreamStatusWidget() {
  const liveState = useLiveState();

  const isLive = liveState?.isLive ?? false;
  const startedAt = isLive ? liveState?.startedAt : undefined;
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
          {startedAt ? <Uptime startedAt={startedAt} className="text-sm" /> : <span className="text-sm">00:00:00</span>}
        </div>
      </div>
      {!isLive && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Stream is offline</div>
      )}
    </div>
  );
}
