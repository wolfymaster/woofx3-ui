import { SHOUTOUT_SCOPE } from "@shared/twitch-chat";
import { normalizeTwitchLogin, readTwitchUserAnswer } from "@shared/twitch-users";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import { useEffect } from "react";
import type { ShoutoutEntryId as HostShoutoutEntryId, ShoutoutQueueView } from "@/desktop/host";
import type { ShoutoutQueueHost } from "@/engine/desktop-host";
import type { ShoutoutsGateway } from "@/engine/gateway";
import type { ReadOptions, ShoutoutEntryId, TwitchChannel } from "@/engine/types";
import { fromShoutoutEntryId } from "./ids";
import { directKeys as k } from "./keys";
import { fromTwitchChannel, toShoutoutEntries } from "./map/shoutouts";
import { toTwitchChannel } from "./map/twitch";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";

/** The host rejects with plain text; callers read `Error.message`. */
async function viaHost<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** The shoutout queue the desktop host keeps, and the channel lookup the engine makes for it. */
export function directShoutoutsGateway(runtime: DirectRuntime, host: ShoutoutQueueHost): ShoutoutsGateway {
  const twitch = directTwitch(runtime);
  const { logger, queryClient } = runtime;

  const queueRead: EngineRead<ShoutoutQueueView> = {
    queryKey: k.shoutouts.queue(),
    queryFn: () => viaHost(host.queue()),
  };

  const useQueue = ({ enabled = true }: ReadOptions = {}) => {
    useEffect(() => {
      if (!enabled) {
        return undefined;
      }
      let stopped = false;
      let stopListening: (() => void) | null = null;
      host
        .onChange((queue) => queryClient.setQueryData(queueRead.queryKey, queue))
        .then((unlisten) => {
          if (stopped) {
            unlisten();
          } else {
            stopListening = unlisten;
          }
        })
        .catch((error: unknown) => {
          logger.error("listening for shoutout queue changes failed", { error: String(error) });
        });
      return () => {
        stopped = true;
        stopListening?.();
      };
    }, [enabled, host]);
    return useEngineQuery(runtime, queueRead, { enabled, select: toShoutoutEntries });
  };

  const lookup = async (input: string): Promise<TwitchChannel | null> => {
    const login = normalizeTwitchLogin(input);
    if (!login) {
      return null;
    }
    // Checked now so a missing permission shows when confirming, not when the host sends it.
    await twitch.authorize(SHOUTOUT_SCOPE);
    const user = await readTwitchUserAnswer(
      await twitch.helix(ENGINE_CAPABILITIES.twitchModeration, "twitchGetUsers", (api) => api.twitchGetUsers({ login }))
    );
    return user ? toTwitchChannel(user) : null;
  };

  const enqueue = async (channel: TwitchChannel): Promise<void> => {
    await viaHost(host.enqueue(fromTwitchChannel(channel)));
  };

  const remove = async (entryId: ShoutoutEntryId): Promise<void> => {
    await viaHost(host.remove(fromShoutoutEntryId(entryId)));
  };

  const reorder = async (entryIds: ShoutoutEntryId[]): Promise<void> => {
    const order = entryIds.map(fromShoutoutEntryId);
    queryClient.setQueryData<ShoutoutQueueView>(queueRead.queryKey, (view) =>
      view ? { ...view, entries: reorderedEntries(view, order) } : view
    );
    try {
      await viaHost(host.reorder(order));
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: queueRead.queryKey });
      throw error;
    }
  };

  return {
    useQueue,
    useLookupRequest: () => useEngineRequest(lookup),
    useEnqueueRequest: () => useEngineRequest(enqueue),
    useRemoveRequest: () => useEngineRequest(remove),
    useReorderRequest: () => useEngineRequest(reorder),
  };
}

/** Entries in `order`, one gone meanwhile skipped; the host's own queue replaces this when it answers. */
function reorderedEntries(view: ShoutoutQueueView, order: HostShoutoutEntryId[]): ShoutoutQueueView["entries"] {
  const byId = new Map(view.entries.map((entry) => [entry.id, entry]));
  return order.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}
