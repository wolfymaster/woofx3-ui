import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, Megaphone, Radio, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useChatters } from "@/hooks/use-chatters";
import { useInstance } from "@/hooks/use-instance";
import { matchChatters } from "@/lib/chatter-match";
import { ShoutoutQueue, type ShoutoutQueueEntry } from "./shoutout-queue";

interface PendingTarget {
  twitchUserId: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
  broadcasterType?: string;
}

function broadcasterBadge(broadcasterType: string | undefined): string | null {
  if (broadcasterType === "partner") {
    return "Partner";
  }
  if (broadcasterType === "affiliate") {
    return "Affiliate";
  }
  return null;
}

export function ShoutoutWidget() {
  const { instance } = useInstance();
  const instanceId = instance?._id;

  const { chatters, error: chattersError } = useChatters();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingTarget | null>(null);
  const [isLooking, setIsLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drives the "retrying in Nm" labels without each row owning a timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const listArgs = instanceId ? { instanceId } : "skip";
  const queue = useQuery(api.shoutouts.listQueue, listArgs);
  const lookupUser = useAction(api.shoutouts.lookupUser);
  const enqueue = useMutation(api.shoutouts.enqueue);
  const removeEntry = useMutation(api.shoutouts.removeEntry);
  const reorderQueue = useMutation(api.shoutouts.reorderQueue).withOptimisticUpdate((localStore, args) => {
    if (!instanceId) {
      return;
    }
    const current = localStore.getQuery(api.shoutouts.listQueue, { instanceId });
    if (!current) {
      return;
    }
    const byId = new Map(current.map((entry) => [entry.id, entry]));
    const reordered = args.entryIds.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
    localStore.setQuery(api.shoutouts.listQueue, { instanceId }, reordered);
  });

  const suggestions = useMemo(() => matchChatters(chatters, query), [chatters, query]);

  // Whether cmdk has anything on screen to act on. Not `suggestions.length`
  // alone: an empty query still ranks the alphabetical head of the roster, but
  // the list is not rendered, so cmdk has nothing highlighted.
  const showingSuggestions = query.length > 0 && suggestions.length > 0;

  // Both the autocomplete and the Send button land here: you can shout out
  // someone who is not currently in chat, so the typed value is as valid an
  // input as a picked one.
  const beginConfirm = useCallback(
    async (login: string) => {
      if (!instanceId || !login.trim()) {
        return;
      }
      setIsLooking(true);
      setError(null);
      try {
        const found = await lookupUser({ instanceId, login });
        if (!found) {
          setError(`No Twitch channel called "${login.trim().replace(/^@/, "")}"`);
          return;
        }
        setPending(found);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLooking(false);
      }
    },
    [instanceId, lookupUser]
  );

  const confirm = useCallback(() => {
    if (!instanceId || !pending) {
      return;
    }
    void enqueue({ instanceId, ...pending });
    setPending(null);
    setQuery("");
  }, [instanceId, pending, enqueue]);

  const handleRemove = useCallback(
    (id: string) => {
      if (!instanceId) {
        return;
      }
      void removeEntry({ instanceId, entryId: id as Id<"shoutoutQueue"> });
    },
    [instanceId, removeEntry]
  );

  const handleReorder = useCallback(
    (ids: string[]) => {
      if (!instanceId) {
        return;
      }
      void reorderQueue({ instanceId, entryIds: ids as Id<"shoutoutQueue">[] });
    },
    [instanceId, reorderQueue]
  );

  const entries: ShoutoutQueueEntry[] = queue ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">Shoutout</span>
        {entries.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">{entries.length} queued · 2m apart</span>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {pending ? (
          <div className="space-y-3 rounded-md border border-border p-3" data-testid="shoutout-confirm">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarImage src={pending.profileImageUrl} alt="" />
                <AvatarFallback>{pending.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{pending.displayName}</span>
                  {broadcasterBadge(pending.broadcasterType) && (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {broadcasterBadge(pending.broadcasterType)}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">twitch.tv/{pending.login}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 gap-1.5" onClick={confirm} data-testid="button-confirm-shoutout">
                <Megaphone className="h-4 w-4" />
                Add to queue
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* shouldFilter={false}: matchChatters does the ranking, and cmdk's
                own scorer would fight it. Command is here for the keyboard
                handling, not the filtering. */}
            <Command shouldFilter={false} className="rounded-md border border-border">
              <CommandInput
                placeholder="Who are we shouting out?"
                value={query}
                onValueChange={setQuery}
                onKeyDown={(event) => {
                  // cmdk already handles Enter whenever it has a highlighted
                  // item, and selecting that chatter is what Enter should do.
                  // Enter is only ours when there is nothing to select, so a
                  // name that is not currently in chat still submits.
                  if (event.key !== "Enter" || showingSuggestions || isLooking) {
                    return;
                  }
                  event.preventDefault();
                  void beginConfirm(query);
                }}
                data-testid="input-shoutout-target"
              />
              {query.length > 0 && (
                <CommandList className="max-h-40">
                  <CommandEmpty>No one in chat matches — Send anyway to shout them out.</CommandEmpty>
                  {suggestions.map((chatter) => (
                    <CommandItem
                      key={chatter.userId}
                      value={chatter.login}
                      onSelect={() => void beginConfirm(chatter.login)}
                    >
                      <span className="truncate">{chatter.displayName}</span>
                      {chatter.displayName.toLowerCase() !== chatter.login && (
                        <span className="ml-1.5 truncate text-xs text-muted-foreground">{chatter.login}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandList>
              )}
            </Command>

            <Button
              size="sm"
              className="w-full gap-1.5"
              disabled={!query.trim() || isLooking}
              onClick={() => void beginConfirm(query)}
              data-testid="button-send-shoutout"
            >
              {isLooking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
              Send
            </Button>

            {error && <p className="text-xs text-destructive">{error}</p>}
            {chattersError && <p className="text-xs text-muted-foreground">Couldn't load chat: {chattersError}</p>}
          </div>
        )}

        {queue === undefined ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-center">
            <Radio className="mb-2 h-7 w-7 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">Nothing queued</p>
          </div>
        ) : (
          <ShoutoutQueue entries={entries} now={now} onRemove={handleRemove} onReorder={handleReorder} />
        )}
      </div>
    </div>
  );
}
