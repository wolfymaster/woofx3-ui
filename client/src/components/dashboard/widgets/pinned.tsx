import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronRight, Loader2, Pin, PinOff, Radio, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Twitch keeps exactly one pinned message per channel, and pinning a new one
// replaces it — so this shows a single current pin, not a list. The list below
// is history: things worth pinning again, kept because the same message tends
// to come back stream after stream.

const PIN_MANAGE_SCOPE = "moderator:manage:chat_messages";
const MAX_MESSAGE_LENGTH = 500;
/** Twitch pushes nothing when a pin changes, so the current pin is polled. */
const PIN_REFRESH_MS = 60_000;

interface CurrentPin {
  messageId: string;
  content: string | null;
  expiresAt?: string;
}

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function PinnedWidget() {
  const { instance } = useInstance();
  const { toast } = useToast();
  const instanceId = instance?._id;

  const platformLinks = useQuery(api.instances.getPlatformLinks, instanceId ? { instanceId } : "skip");
  const history = useQuery(api.pins.listHistory, instanceId ? { instanceId } : "skip");

  const currentPinAction = useAction(api.pins.currentPin);
  const pinNewMessage = useAction(api.pins.pinNewMessage);
  const repinFromHistory = useAction(api.pins.repinFromHistory);
  const unpinCurrent = useAction(api.pins.unpinCurrent);
  const removeFromHistory = useMutation(api.pins.removeFromHistory);

  const [current, setCurrent] = useState<CurrentPin | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** Session-local, not persisted: a starting height, not a remembered preference. */
  const [historyOpen, setHistoryOpen] = useState(false);

  const twitchLink = platformLinks?.find((link) => link.platform === "twitch");
  // Reading the current pin needs only the read scope, which existing links
  // already carry — so the pin is visible even when pinning is not yet allowed.
  const canPin = !!twitchLink?.scopes.includes(PIN_MANAGE_SCOPE);

  const refreshCurrent = useCallback(() => {
    if (!instanceId) {
      return;
    }
    currentPinAction({ instanceId })
      .then(setCurrent)
      .catch(() => {
        // A failed read is not worth a toast on a timer; the card just keeps
        // showing what it last knew.
      });
  }, [instanceId, currentPinAction]);

  useEffect(() => {
    refreshCurrent();
    const timer = setInterval(refreshCurrent, PIN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshCurrent]);

  const report = (error: unknown, title: string) => {
    toast({
      title,
      description: error instanceof Error ? error.message : String(error),
      variant: "destructive",
    });
  };

  const run = async (work: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await work();
      refreshCurrent();
    } catch (error) {
      report(error, failure);
    } finally {
      setBusy(false);
    }
  };

  const handlePinNew = () => {
    if (!instanceId || !draft.trim()) {
      return;
    }
    void run(async () => {
      await pinNewMessage({ instanceId, text: draft });
      setDraft("");
    }, "Couldn't pin that message");
  };

  const handleRepin = (entryId: string) => {
    if (!instanceId) {
      return;
    }
    void run(async () => {
      const result = await repinFromHistory({ instanceId, entryId: entryId as Id<"pinnedMessages"> });
      if (result.resent) {
        // Worth saying: the original message was too old to pin, so this posted
        // a new copy into chat rather than re-pinning the one people remember.
        toast({ title: "Posted again and pinned", description: "The original message was no longer pinnable." });
      }
    }, "Couldn't re-pin that");
  };

  const handleUnpin = () => {
    if (!instanceId || !current) {
      return;
    }
    void run(() => unpinCurrent({ instanceId, messageId: current.messageId }), "Couldn't unpin that");
  };

  if (platformLinks !== undefined && !twitchLink) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Radio className="h-8 w-8 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Connect Twitch in Settings to manage pinned messages</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-auto p-3">
        <section className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Currently pinned</span>
          {current ? (
            <div className="flex items-start gap-2 rounded-md border border-border p-2" data-testid="current-pin">
              <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs">
                {current.content ?? (
                  // Twitch returns only the message id, never the text — so a pin
                  // made from Twitch's own UI can be reported but not quoted.
                  <span className="text-muted-foreground italic">A message pinned outside this app</span>
                )}
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={handleUnpin}
                disabled={busy || !canPin}
                aria-label="Unpin"
                data-testid="button-unpin-current"
              >
                <PinOff className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing pinned right now.</p>
          )}
        </section>

        <section className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            placeholder="Post a message and pin it…"
            rows={2}
            className="resize-none text-sm"
            data-testid="input-pin-message"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={handlePinNew}
              disabled={busy || !draft.trim() || !canPin}
              data-testid="button-pin-message"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pin className="h-4 w-4" />}
              Pin message
            </Button>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {draft.length}/{MAX_MESSAGE_LENGTH}
            </span>
          </div>
          {!canPin && platformLinks !== undefined && (
            <p className="text-xs text-muted-foreground">
              Reconnect Twitch in Settings → Integrations to grant the pinning permission.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Pinning posts this as a chat message from your account — Twitch pins messages, not free-floating text.
          </p>
        </section>

        <section className="space-y-1.5">
          {history === undefined ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? null : (
            // Collapsed by default: the history grows without bound, and the
            // thing you usually want from this widget is the box above it. The
            // count goes on the trigger so a fold is not a disappearance.
            <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
              <CollapsibleTrigger className="flex w-full items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
                <ChevronRight className={cn("h-3 w-3 transition-transform", historyOpen && "rotate-90")} />
                History · {history.length}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1.5">
                <ul className="space-y-1.5">
                  {history.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start gap-2 rounded-md border border-border p-2"
                      data-testid={`pin-history-${entry.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap break-words text-xs">{entry.content}</p>
                        <span className="text-[10px] text-muted-foreground">
                          {entry.lastPinnedAt
                            ? `Last pinned ${formatWhen(entry.lastPinnedAt)}`
                            : formatWhen(entry.createdAt)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => handleRepin(entry.id)}
                        disabled={busy || !canPin}
                        aria-label={`Pin "${entry.content.slice(0, 40)}" again`}
                        data-testid={`button-repin-${entry.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (instanceId) {
                            void removeFromHistory({ instanceId, entryId: entry.id as Id<"pinnedMessages"> });
                          }
                        }}
                        aria-label="Remove from history"
                        data-testid={`button-remove-pin-${entry.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}
        </section>
      </div>
    </div>
  );
}
