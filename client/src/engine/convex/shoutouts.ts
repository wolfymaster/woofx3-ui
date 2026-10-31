import { api } from "@convex/_generated/api";
import type { OptimisticLocalStore } from "convex/browser";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { ShoutoutsGateway } from "@/engine/gateway";
import type { ReadOptions, ShoutoutEntry, ShoutoutEntryId, TwitchChannel } from "@/engine/types";
import { withPlainError } from "./errors";
import { fromShoutoutEntryId, toShoutoutEntryId } from "./ids";
import { useMappedList } from "./mapped";
import { useInstanceAction, useInstanceMutation, useScopeInstanceId } from "./scope";

// Convex keeps the queue and works through it on a schedule, sending each
// shoutout through the engine when the engine advertises `twitch.chat`.

type QueueRow = FunctionReturnType<typeof api.shoutouts.listQueue>[number];
type LookupRow = NonNullable<FunctionReturnType<typeof api.shoutouts.lookupUser>>;

export function toShoutoutEntry(row: QueueRow): ShoutoutEntry {
  return {
    id: toShoutoutEntryId(row.id),
    login: row.login,
    displayName: row.displayName,
    profileImageUrl: row.profileImageUrl ?? null,
    broadcasterType: row.broadcasterType ?? null,
    attempts: row.attempts,
    nextEligibleAt: row.nextEligibleAt,
    lastError: row.lastError ?? null,
  };
}

export function toTwitchChannel(user: LookupRow): TwitchChannel {
  return {
    twitchUserId: user.twitchUserId,
    login: user.login,
    displayName: user.displayName,
    profileImageUrl: user.profileImageUrl ?? null,
    broadcasterType: user.broadcasterType ?? null,
  };
}

/** Shows the new order before the mutation lands, so a dragged row does not jump back. */
export function reorderQueueOptimistically(
  localStore: OptimisticLocalStore,
  args: FunctionArgs<typeof api.shoutouts.reorderQueue>
): void {
  const current = localStore.getQuery(api.shoutouts.listQueue, { instanceId: args.instanceId });
  if (!current) {
    return;
  }
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const reordered = args.entryIds.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
  localStore.setQuery(api.shoutouts.listQueue, { instanceId: args.instanceId }, reordered);
}

function useQueue({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.shoutouts.listQueue, enabled && instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toShoutoutEntry);
}

function useLookupRequest() {
  const lookupUser = useInstanceAction(api.shoutouts.lookupUser);
  return useCallback(
    async (login: string) => {
      const user = await lookupUser({ login }).catch(withPlainError);
      return user ? toTwitchChannel(user) : null;
    },
    [lookupUser]
  );
}

function useEnqueueRequest() {
  const enqueue = useInstanceMutation(api.shoutouts.enqueue);
  return useCallback(
    async ({ twitchUserId, login, displayName, profileImageUrl, broadcasterType }: TwitchChannel) => {
      await enqueue({
        twitchUserId,
        login,
        displayName,
        profileImageUrl: profileImageUrl ?? undefined,
        broadcasterType: broadcasterType ?? undefined,
      }).catch(withPlainError);
    },
    [enqueue]
  );
}

function useRemoveRequest() {
  const removeEntry = useInstanceMutation(api.shoutouts.removeEntry);
  return useCallback(
    async (entryId: ShoutoutEntryId) => {
      await removeEntry({ entryId: fromShoutoutEntryId(entryId) }).catch(withPlainError);
    },
    [removeEntry]
  );
}

function useReorderRequest() {
  const reorderQueue = useInstanceMutation(api.shoutouts.reorderQueue, reorderQueueOptimistically);
  return useCallback(
    async (entryIds: ShoutoutEntryId[]) => {
      await reorderQueue({ entryIds: entryIds.map(fromShoutoutEntryId) }).catch(withPlainError);
    },
    [reorderQueue]
  );
}

function useCanShoutOut({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  return useQuery(api.supporters.canShoutOut, enabled && instanceId ? { instanceId } : "skip");
}

export const convexShoutoutsGateway: ShoutoutsGateway = {
  support: { queue: true },
  useCanShoutOut,
  useQueue,
  useLookupRequest,
  useEnqueueRequest,
  useRemoveRequest,
  useReorderRequest,
};
