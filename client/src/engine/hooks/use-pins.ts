import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

/** Messages worth pinning again, newest first. */
export function usePinHistory(options?: ReadOptions) {
  return useEngineGateway().pins.useHistory(options);
}

/** Reads what Twitch has pinned now; null when nothing is. */
export function useCurrentPinRequest() {
  return useEngineGateway().pins.useCurrentRequest();
}

/** Posts a message and pins it. */
export function usePinNewMessageRequest() {
  return useEngineGateway().pins.usePinNewRequest();
}

export function useRepinRequest() {
  return useEngineGateway().pins.useRepinRequest();
}

export function useUnpinRequest() {
  return useEngineGateway().pins.useUnpinRequest();
}

export function useRemovePinHistoryEntryRequest() {
  return useEngineGateway().pins.useRemoveFromHistoryRequest();
}
