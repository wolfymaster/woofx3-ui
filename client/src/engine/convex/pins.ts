import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { PinsGateway } from "@/engine/gateway";
import type { CurrentPin, PinHistoryEntry, PinHistoryEntryId, ReadOptions } from "@/engine/types";
import { withPlainError } from "./errors";
import { fromPinHistoryEntryId, toPinHistoryEntryId } from "./ids";
import { useMappedList } from "./mapped";
import { useInstanceAction, useInstanceMutation, useScopeInstanceId } from "./scope";

// Convex keeps the pin history, and pins with the broadcaster token it holds,
// through the engine when the engine advertises `twitch.pins`.

type HistoryRow = FunctionReturnType<typeof api.pins.listHistory>[number];
type CurrentPinRow = NonNullable<FunctionReturnType<typeof api.pins.currentPin>>;

export function toPinHistoryEntry(row: HistoryRow): PinHistoryEntry {
  return {
    id: toPinHistoryEntryId(row.id),
    content: row.content,
    authorName: row.authorName,
    twitchMessageId: row.twitchMessageId,
    createdAt: row.createdAt,
    lastPinnedAt: row.lastPinnedAt,
  };
}

export function toCurrentPin(pin: CurrentPinRow): CurrentPin {
  return {
    messageId: pin.messageId,
    content: pin.content,
    authorName: pin.authorName,
    expiresAt: pin.expiresAt,
  };
}

function useHistory({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.pins.listHistory, enabled && instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toPinHistoryEntry);
}

function useCurrentRequest() {
  const currentPin = useInstanceAction(api.pins.currentPin);
  return useCallback(async () => {
    const pin = await currentPin({}).catch(withPlainError);
    return pin ? toCurrentPin(pin) : null;
  }, [currentPin]);
}

function usePinNewRequest() {
  const pinNewMessage = useInstanceAction(api.pins.pinNewMessage);
  return useCallback(
    async (text: string) => {
      const { messageId } = await pinNewMessage({ text }).catch(withPlainError);
      return { messageId };
    },
    [pinNewMessage]
  );
}

function useRepinRequest() {
  const repinFromHistory = useInstanceAction(api.pins.repinFromHistory);
  return useCallback(
    async (entryId: PinHistoryEntryId) => {
      const { messageId, resent } = await repinFromHistory({ entryId: fromPinHistoryEntryId(entryId) }).catch(
        withPlainError
      );
      return { messageId, resent };
    },
    [repinFromHistory]
  );
}

function useUnpinRequest() {
  const unpinCurrent = useInstanceAction(api.pins.unpinCurrent);
  return useCallback(
    async (messageId: string) => {
      await unpinCurrent({ messageId }).catch(withPlainError);
    },
    [unpinCurrent]
  );
}

function useRemoveFromHistoryRequest() {
  const removeFromHistory = useInstanceMutation(api.pins.removeFromHistory);
  return useCallback(
    async (entryId: PinHistoryEntryId) => {
      await removeFromHistory({ entryId: fromPinHistoryEntryId(entryId) }).catch(withPlainError);
    },
    [removeFromHistory]
  );
}

export const convexPinsGateway: PinsGateway = {
  useHistory,
  useCurrentRequest,
  usePinNewRequest,
  useRepinRequest,
  useUnpinRequest,
  useRemoveFromHistoryRequest,
};
