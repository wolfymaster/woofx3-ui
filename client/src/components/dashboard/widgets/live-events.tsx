import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Gift, Heart, Radio, UserPlus, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { useInstance } from "@/hooks/use-instance";
import type { PlatformEvent, PlatformEventType } from "@/lib/platforms/types";
import { usePlatformEvents } from "@/lib/platforms/use-platform-events";
import { cn } from "@/lib/utils";

const EVENT_TYPES: PlatformEventType[] = ["follow", "subscribe", "cheer", "raid"];
const MAX_EVENTS = 50;

const eventDisplay: Record<PlatformEventType, { icon: typeof UserPlus; color: string; label: string }> = {
  follow: { icon: UserPlus, color: "text-blue-500", label: "Follow" },
  subscribe: { icon: Heart, color: "text-purple-500", label: "Subscribe" },
  cheer: { icon: Gift, color: "text-yellow-500", label: "Cheer" },
  raid: { icon: Zap, color: "text-orange-500", label: "Raid" },
};

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  return `${Math.floor(seconds / 3600)}h ago`;
}

function EventDetail({ event }: { event: PlatformEvent }) {
  if (event.type === "cheer" && event.amount != null) {
    return <span className="text-xs text-muted-foreground">{event.amount} bits</span>;
  }
  if (event.type === "raid" && event.amount != null) {
    return <span className="text-xs text-muted-foreground">{event.amount} viewers</span>;
  }
  if (event.type === "subscribe" && event.tier) {
    return <span className="text-xs text-muted-foreground">Tier {event.tier}</span>;
  }
  if (event.message) {
    return <p className="text-xs text-muted-foreground truncate">{event.message}</p>;
  }
  return null;
}

export function LiveEventsWidget() {
  const { instance } = useInstance();
  const platformLinks = useQuery(api.instances.getPlatformLinks, instance ? { instanceId: instance._id } : "skip");
  const [events, setEvents] = useState<PlatformEvent[]>([]);

  const hasTwitch = !!platformLinks?.some((link) => link.platform === "twitch");

  const handleEvent = useCallback((event: PlatformEvent) => {
    setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
  }, []);

  usePlatformEvents(EVENT_TYPES, handleEvent);

  if (!hasTwitch) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Radio className="h-8 w-8 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Connect Twitch in Settings to see live events</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-semibold">Live Events</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Live
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-0.5">
        {events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Radio className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">Waiting for events...</p>
          </div>
        ) : (
          events.map((event) => {
            const display = eventDisplay[event.type];
            const Icon = display.icon;
            return (
              <div
                key={event.id}
                className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                data-testid={`live-event-${event.id}`}
              >
                <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-muted")}>
                  <Icon className={cn("h-4 w-4", display.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{event.userName}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatTimeAgo(event.timestamp)}</span>
                  </div>
                  <EventDetail event={event} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
