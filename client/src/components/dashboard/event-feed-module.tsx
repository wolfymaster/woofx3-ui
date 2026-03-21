import { useState, useEffect } from 'react';
import { Bell, Heart, Gift, UserPlus, Star, Zap, Filter, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { transport } from '@/lib/transport';
import type { StreamEvent } from '@/lib/transport';
import { useInstance } from '@/hooks/use-instance';

const eventConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string; label: string }> = {
  follow:    { icon: UserPlus, color: 'text-blue-500',   bg: 'bg-blue-500/10',   label: 'New Follower' },
  subscribe: { icon: Star,     color: 'text-purple-500', bg: 'bg-purple-500/10', label: 'Subscription' },
  bits:      { icon: Gift,     color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Cheer' },
  raid:      { icon: Zap,      color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Raid' },
  cheer:     { icon: Gift,     color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Cheer' },
  gift:      { icon: Gift,     color: 'text-green-500',  bg: 'bg-green-500/10',  label: 'Gift Sub' },
  custom:    { icon: Heart,    color: 'text-pink-500',   bg: 'bg-pink-500/10',   label: 'Event' },
};

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function EventItem({ event }: { event: StreamEvent }) {
  const config = eventConfig[event.type] ?? eventConfig.custom;
  const EventIcon = config.icon;
  const displayName = event.username ?? 'Unknown';

  return (
    <div
      className="flex items-start gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors"
      data-testid={`event-${event.id}`}
    >
      <div className={cn('h-8 w-8 rounded-full flex items-center justify-center shrink-0', config.bg)}>
        <EventIcon className={cn('h-4 w-4', config.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{displayName}</span>
          <Badge variant="secondary" className={cn('text-[10px]', config.color)}>
            {config.label}
          </Badge>
          {event.amount != null && (
            <Badge variant="outline" className="text-[10px]">
              {event.type === 'bits' || event.type === 'cheer'
                ? `${event.amount} bits`
                : event.type === 'raid'
                ? `${event.amount} viewers`
                : `x${event.amount}`}
            </Badge>
          )}
        </div>
        {event.message && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{event.message}</p>
        )}
        <p className="text-[10px] text-muted-foreground mt-0.5">{formatTimeAgo(event.timestamp)}</p>
      </div>
    </div>
  );
}

interface EventFeedModuleProps {
  config?: Record<string, unknown>;
}

export function EventFeedModule({ config: _config }: EventFeedModuleProps) {
  const { instance } = useInstance();
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Subscribe to stream events via transport
  useEffect(() => {
    if (!instance) return;
    const instanceId = instance._id;

    const unsubscribe = transport.subscribeStreamEvents(instanceId, (event) => {
      setEvents((prev) => [event, ...prev].slice(0, 50));
    });

    return unsubscribe;
  }, [instance?._id, refreshKey]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Event Feed</span>
          <Badge variant="secondary" className="text-xs">
            <Bell className="h-3 w-3 mr-1" />
            {events.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Filter className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => { setEvents([]); setRefreshKey((k) => k + 1); }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {events.length === 0 ? (
            <div className="py-8 text-center">
              <Bell className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                {instance ? 'No events yet' : 'No instance connected'}
              </p>
            </div>
          ) : (
            events.map((event) => (
              <EventItem key={event.id} event={event} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
