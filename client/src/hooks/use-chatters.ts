import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { useInstance } from "@/hooks/use-instance";
import type { ChatterOption } from "@/lib/chatter-match";

// Who is currently in chat, for the shoutout autocomplete.
//
// The roster comes from a Convex action, not a query, so there is no reactive
// result for several components to share -- two widgets mounting would be two
// Helix calls. A throttle alone would not fix that: it would let one through
// and leave the other with nothing. So the cache lives here at module scope,
// holding the last roster and the in-flight promise, and every caller reads the
// same one. Same shape the engine's chatter lookups use.

const ROSTER_TTL_MS = 60_000;

interface CacheEntry {
  instanceId: string;
  fetchedAt: number;
  chatters: ChatterOption[];
}

type Fetcher = (args: { instanceId: Id<"instances"> }) => Promise<ChatterOption[]>;

let cache: CacheEntry | null = null;
let inFlight: Promise<ChatterOption[]> | null = null;
const subscribers = new Set<(chatters: ChatterOption[]) => void>();

function publish(chatters: ChatterOption[]): void {
  subscribers.forEach((notify) => {
    notify(chatters);
  });
}

async function loadRoster(instanceId: Id<"instances">, fetcher: Fetcher, force: boolean): Promise<ChatterOption[]> {
  const fresh = cache && cache.instanceId === instanceId && Date.now() - cache.fetchedAt < ROSTER_TTL_MS;
  if (fresh && !force) {
    return cache?.chatters ?? [];
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = fetcher({ instanceId })
    .then((chatters) => {
      cache = { instanceId, fetchedAt: Date.now(), chatters };
      publish(chatters);
      return chatters;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Exposed for tests and for a deliberate refresh after reconnecting Twitch. */
export function resetChatterRoster(): void {
  cache = null;
  inFlight = null;
}

export interface UseChatters {
  chatters: ChatterOption[];
  isLoading: boolean;
  /** Missing scope, revoked token, Twitch down — surfaced rather than swallowed. */
  error: string | null;
  refresh: () => void;
}

export function useChatters(): UseChatters {
  const { instance } = useInstance();
  const listChatters = useAction(api.shoutouts.listChatters) as Fetcher;
  const instanceId = instance?._id;

  const [chatters, setChatters] = useState<ChatterOption[]>(() => cache?.chatters ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    subscribers.add(setChatters);
    return () => {
      subscribers.delete(setChatters);
    };
  }, []);

  const load = useCallback(
    (force: boolean) => {
      if (!instanceId) {
        return;
      }
      setIsLoading(true);
      setError(null);
      loadRoster(instanceId, listChatters, force)
        .then((next) => setChatters(next))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setIsLoading(false));
    },
    [instanceId, listChatters]
  );

  // A roster goes stale as people come and go, so it refreshes on an interval
  // while something is actually showing it rather than only on mount.
  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(false), ROSTER_TTL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { chatters, isLoading, error, refresh };
}
