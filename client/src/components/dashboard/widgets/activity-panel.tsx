import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Gift, Heart, Star, Trash2, UserPlus, Zap } from "lucide-react";
import { useCallback } from "react";
import { LiveEventsWidget } from "@/components/dashboard/widgets/live-events";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import type { PlatformEvent } from "@/lib/platforms/types";

// One card, two tabs, instead of two tiled widgets. Chat is deliberately
// absent: this app has no chat data path at all right now — the transport
// dropped chat send, and the engine's stream-event channel excludes chat for
// backpressure reasons — so a Chat tab could only have been a placeholder.
//
// Pinned used to be a third tab holding hand-written notes. Pinning now means
// real Twitch pinning and lives in its own widget; those old notes survive as
// re-pinnable history there (see convex/pins.ts).

const highlightIcons: Record<string, typeof Star> = {
  follow: UserPlus,
  subscribe: Heart,
  cheer: Gift,
  raid: Zap,
  note: Star,
};

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function EmptyTab({ icon: Icon, children }: { icon: typeof Star; children: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-4">
      <Icon className="h-8 w-8 text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function HighlightsTab() {
  const { instance } = useInstance();
  const highlights = useQuery(api.activityPanel.listHighlights, instance ? { instanceId: instance._id } : "skip");
  const removeHighlight = useMutation(api.activityPanel.removeHighlight);

  if (highlights !== undefined && highlights.length === 0) {
    return <EmptyTab icon={Star}>Star an event on the Events tab to keep it here.</EmptyTab>;
  }

  return (
    <div className="h-full overflow-auto">
      <ul className="divide-y divide-border">
        {(highlights ?? []).map((highlight: Doc<"streamHighlights">) => {
          const Icon = highlightIcons[highlight.kind] ?? Star;
          return (
            <li
              key={highlight._id}
              className="flex items-start gap-3 px-3 py-2"
              data-testid={`highlight-${highlight._id}`}
            >
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{highlight.userName}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{formatWhen(highlight.occurredAt)}</span>
                </div>
                {highlight.detail && <p className="text-xs text-muted-foreground truncate">{highlight.detail}</p>}
              </div>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => void removeHighlight({ highlightId: highlight._id })}
                aria-label="Remove highlight"
                data-testid={`button-remove-highlight-${highlight._id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Describes a live event the way the highlights feed stores it. */
function highlightDetail(event: PlatformEvent): string | undefined {
  if (event.type === "cheer" && event.amount != null) {
    return `${event.amount} bits`;
  }
  if (event.type === "raid" && event.amount != null) {
    return `${event.amount} viewers`;
  }
  if (event.type === "subscribe" && event.tier) {
    return `Tier ${event.tier}`;
  }
  return event.message;
}

export function ActivityPanelWidget() {
  const { instance } = useInstance();
  const { toast } = useToast();
  const saveHighlight = useMutation(api.activityPanel.saveHighlight);

  const handleSaveHighlight = useCallback(
    (event: PlatformEvent) => {
      if (!instance) {
        return;
      }
      void saveHighlight({
        instanceId: instance._id,
        kind: event.type,
        userName: event.userName,
        detail: highlightDetail(event),
        amount: event.amount,
        occurredAt: event.timestamp.getTime(),
      })
        .then(() => toast({ title: "Saved to Highlights" }))
        .catch((error: unknown) =>
          toast({
            title: "Couldn't save that highlight",
            description: error instanceof Error ? error.message : String(error),
            variant: "destructive",
          })
        );
    },
    [instance, saveHighlight, toast]
  );

  return (
    <Tabs defaultValue="events" className="h-full flex flex-col">
      <TabsList className="shrink-0 m-2 grid grid-cols-2">
        <TabsTrigger value="events" data-testid="tab-activity-events">
          Events
        </TabsTrigger>
        <TabsTrigger value="highlights" data-testid="tab-activity-highlights">
          Highlights
        </TabsTrigger>
      </TabsList>

      {/* Each tab keeps its own scroll area; forceMount would keep the events
          subscription alive across tab switches, but usePlatformEvents is
          ref-counted and cheap to re-establish, so plain unmounting is fine. */}
      <TabsContent value="events" className="flex-1 min-h-0 mt-0">
        <LiveEventsWidget hideHeader onSaveHighlight={handleSaveHighlight} />
      </TabsContent>
      <TabsContent value="highlights" className="flex-1 min-h-0 mt-0">
        <HighlightsTab />
      </TabsContent>
    </Tabs>
  );
}
