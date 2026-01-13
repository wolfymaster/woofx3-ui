import { useState } from 'react';
import { Bell, Heart, Gift, UserPlus, Star, Zap, Filter, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface StreamEvent {
  id: string;
  type: 'follow' | 'subscription' | 'donation' | 'raid' | 'cheer' | 'gift';
  user: string;
  message?: string;
  amount?: number;
  timestamp: Date;
}

const mockEvents: StreamEvent[] = [
  { id: 'e1', type: 'subscription', user: 'StreamFan42', message: 'Thanks for the awesome content!', timestamp: new Date(Date.now() - 15000) },
  { id: 'e2', type: 'donation', user: 'GamerPro', amount: 25, message: 'Keep up the great work!', timestamp: new Date(Date.now() - 45000) },
  { id: 'e3', type: 'follow', user: 'NewViewer123', timestamp: new Date(Date.now() - 60000) },
  { id: 'e4', type: 'cheer', user: 'BitsKing', amount: 500, message: 'Amazing play!', timestamp: new Date(Date.now() - 120000) },
  { id: 'e5', type: 'raid', user: 'FriendlyStreamer', amount: 150, timestamp: new Date(Date.now() - 180000) },
  { id: 'e6', type: 'gift', user: 'GenerousViewer', amount: 5, timestamp: new Date(Date.now() - 240000) },
  { id: 'e7', type: 'follow', user: 'CuriousOne', timestamp: new Date(Date.now() - 300000) },
  { id: 'e8', type: 'subscription', user: 'LoyalFan', timestamp: new Date(Date.now() - 360000) },
];

const eventConfig = {
  follow: { icon: UserPlus, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'New Follower' },
  subscription: { icon: Star, color: 'text-purple-500', bg: 'bg-purple-500/10', label: 'Subscription' },
  donation: { icon: Heart, color: 'text-pink-500', bg: 'bg-pink-500/10', label: 'Donation' },
  raid: { icon: Zap, color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Raid' },
  cheer: { icon: Gift, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Cheer' },
  gift: { icon: Gift, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Gift Sub' },
};

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function EventItem({ event }: { event: StreamEvent }) {
  const config = eventConfig[event.type];
  const EventIcon = config.icon;

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
          <span className="text-sm font-semibold">{event.user}</span>
          <Badge variant="secondary" className={cn('text-[10px]', config.color)}>
            {config.label}
          </Badge>
          {event.amount && (
            <Badge variant="outline" className="text-[10px]">
              {event.type === 'donation' ? `$${event.amount}` : 
               event.type === 'cheer' ? `${event.amount} bits` :
               event.type === 'raid' ? `${event.amount} viewers` :
               `x${event.amount}`}
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

export function EventFeedModule() {
  const [events] = useState<StreamEvent[]>(mockEvents);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const todayStats = {
    follows: events.filter(e => e.type === 'follow').length,
    subs: events.filter(e => e.type === 'subscription').length,
    donations: events.filter(e => e.type === 'donation').reduce((sum, e) => sum + (e.amount || 0), 0),
  };

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
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>
      
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {events.length === 0 ? (
            <div className="py-8 text-center">
              <Bell className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No events yet</p>
            </div>
          ) : (
            events.map((event) => (
              <EventItem key={event.id} event={event} />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="px-3 py-2 border-t border-border shrink-0">
        <div className="flex items-center justify-around text-center">
          <div>
            <p className="text-lg font-bold">{todayStats.follows}</p>
            <p className="text-[10px] text-muted-foreground">Follows</p>
          </div>
          <div>
            <p className="text-lg font-bold">{todayStats.subs}</p>
            <p className="text-[10px] text-muted-foreground">Subs</p>
          </div>
          <div>
            <p className="text-lg font-bold">${todayStats.donations}</p>
            <p className="text-[10px] text-muted-foreground">Donations</p>
          </div>
        </div>
      </div>
    </div>
  );
}
