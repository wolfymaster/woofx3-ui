import { useState } from "react";
import { Activity, Heart, MessageSquare, UserPlus, Gift } from "lucide-react";
import { Card } from "@/components/ui/card";

interface RecentEvent {
  id: string;
  type: "follow" | "subscribe" | "cheer" | "raid" | "message";
  user: string;
  message?: string;
  amount?: number;
  timestamp: string;
}

const mockEvents: RecentEvent[] = [
  { id: "1", type: "follow", user: "StreamFan123", timestamp: "2m ago" },
  { id: "2", type: "subscribe", user: "LoyalViewer", amount: 1, timestamp: "5m ago" },
  { id: "3", type: "cheer", user: "CheerGiver", amount: 100, message: "Great stream!", timestamp: "10m ago" },
  { id: "4", type: "message", user: "ChatUser", message: "Hello everyone!", timestamp: "12m ago" },
];

function EventIcon({ type }: { type: RecentEvent["type"] }) {
  switch (type) {
    case "follow":
      return <UserPlus className="h-4 w-4 text-blue-500" />;
    case "subscribe":
      return <Heart className="h-4 w-4 text-red-500" />;
    case "cheer":
      return <Gift className="h-4 w-4 text-purple-500" />;
    case "message":
      return <MessageSquare className="h-4 w-4 text-green-500" />;
    default:
      return <Activity className="h-4 w-4 text-muted-foreground" />;
  }
}

export function RecentEventsWidget() {
  const [events] = useState<RecentEvent[]>(mockEvents);

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Recent Events</span>
      </div>
      <div className="flex-1 overflow-auto space-y-2">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-2 p-2 rounded-md bg-muted/50"
          >
            <EventIcon type={event.type} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">{event.user}</span>
                <span className="text-xs text-muted-foreground">{event.timestamp}</span>
              </div>
              {event.message && (
                <p className="text-xs text-muted-foreground truncate">{event.message}</p>
              )}
              {event.amount && (
                <span className="text-xs text-muted-foreground">
                  {event.type === "cheer" ? `${event.amount} bits` : `Tier ${event.amount}`}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
