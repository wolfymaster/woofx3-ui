import { useState, useEffect } from "react";
import { Radio, Users, Clock, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useInstance } from "@/hooks/use-instance";

export function StreamStatusWidget() {
  const { instance } = useInstance();
  const [isLive, setIsLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [uptime, setUptime] = useState("00:00:00");

  useEffect(() => {
    if (!instance) return;

    // TODO: Subscribe to engine stream status via WebSocket
    // For now, show placeholder
    setIsLive(false);
    setViewerCount(0);
  }, [instance]);

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
          <span className="text-sm">{viewerCount} viewers</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{uptime}</span>
        </div>
      </div>
      {!isLive && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Stream is offline
        </div>
      )}
    </div>
  );
}
