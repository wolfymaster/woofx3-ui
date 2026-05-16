import { useState } from "react";
import { Bell, SkipForward, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QueuedAlert {
  id: string;
  type: string;
  user: string;
  priority: number;
}

const mockAlerts: QueuedAlert[] = [
  { id: "1", type: "follow", user: "NewFollower", priority: 1 },
  { id: "2", type: "subscribe", user: "Subscriber", priority: 2 },
];

export function AlertQueueWidget() {
  const [alerts, setAlerts] = useState<QueuedAlert[]>(mockAlerts);
  const [isPaused, setIsPaused] = useState(false);

  const handleSkip = () => {
    setAlerts((prev) => prev.slice(1));
  };

  const handleClear = () => {
    setAlerts([]);
  };

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Alert Queue</span>
        </div>
        <span className="text-xs text-muted-foreground">{alerts.length} pending</span>
      </div>
      <div className="flex-1 overflow-auto space-y-2">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="flex items-center justify-between p-2 rounded-md bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <Bell className="h-3 w-3 text-muted-foreground" />
              <span className="text-sm">{alert.user}</span>
            </div>
            <span className="text-xs text-muted-foreground capitalize">{alert.type}</span>
          </div>
        ))}
        {alerts.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No alerts in queue
          </div>
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => setIsPaused(!isPaused)}
        >
          {isPaused ? (
            <Play className="h-3 w-3 mr-1" />
          ) : (
            <Pause className="h-3 w-3 mr-1" />
          )}
          {isPaused ? "Resume" : "Pause"}
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={handleSkip}>
          <SkipForward className="h-3 w-3 mr-1" />
          Skip
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={handleClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
