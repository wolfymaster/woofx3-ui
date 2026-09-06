import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Gift, Heart, Pin, Star, Trash2, UserPlus, X, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { LiveEventsWidget } from "@/components/dashboard/widgets/live-events";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import type { PlatformEvent } from "@/lib/platforms/types";

// One card, three tabs, instead of three tiled widgets. Chat is deliberately
// absent: this app has no chat data path at all right now (the transport layer
// dropped chat send, and neither the engine webhook feed nor the browser's
// direct EventSub subscription carries chat messages), so a Chat tab could
// only have been a placeholder.

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

function EmptyTab({ icon: Icon, children }: { icon: typeof Pin; children: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-4">
      <Icon className="h-8 w-8 text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function PinnedTab() {
  const { instance } = useInstance();
  const { toast } = useToast();
  const pinned = useQuery(api.activityPanel.listPinned, instance ? { instanceId: instance._id } : "skip");
  const pin = useMutation(api.activityPanel.pin);
  const unpin = useMutation(api.activityPanel.unpin);

  const [draft, setDraft] = useState("");

  const handlePin = async () => {
    if (!instance || !draft.trim()) {
      return;
    }
    try {
      await pin({ instanceId: instance._id, content: draft });
      setDraft("");
    } catch (error) {
      toast({
        title: "Couldn't pin that",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 p-2 border-b border-border flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Something to keep in front of you…"
          rows={2}
          className="resize-none text-sm"
          data-testid="input-pin-content"
        />
        <Button
          size="sm"
          onClick={() => void handlePin()}
          disabled={!instance || !draft.trim()}
          data-testid="button-pin"
        >
          <Pin className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {pinned === undefined ? null : pinned.length === 0 ? (
          <EmptyTab icon={Pin}>Nothing pinned yet.</EmptyTab>
        ) : (
          <ul className="divide-y divide-border">
            {pinned.map((message: Doc<"pinnedMessages">) => (
              <li key={message._id} className="flex items-start gap-2 px-3 py-2" data-testid={`pinned-${message._id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                  <span className="text-[10px] text-muted-foreground">
                    {message.authorName ? `${message.authorName} · ` : ""}
                    {formatWhen(message.pinnedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void unpin({ messageId: message._id })}
                  aria-label="Unpin"
                  data-testid={`button-unpin-${message._id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
      <TabsList className="shrink-0 m-2 grid grid-cols-3">
        <TabsTrigger value="events" data-testid="tab-activity-events">
          Events
        </TabsTrigger>
        <TabsTrigger value="pinned" data-testid="tab-activity-pinned">
          Pinned
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
      <TabsContent value="pinned" className="flex-1 min-h-0 mt-0">
        <PinnedTab />
      </TabsContent>
      <TabsContent value="highlights" className="flex-1 min-h-0 mt-0">
        <HighlightsTab />
      </TabsContent>
    </Tabs>
  );
}
