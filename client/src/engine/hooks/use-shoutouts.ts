import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

/** Channels waiting for a shoutout, in queue order. */
export function useShoutoutQueue(options?: ReadOptions) {
  return useEngineGateway().shoutouts.useQueue(options);
}

/** Finds the channel a login names, to confirm before queueing a shoutout. */
export function useLookupTwitchChannelRequest() {
  return useEngineGateway().shoutouts.useLookupRequest();
}

export function useEnqueueShoutoutRequest() {
  return useEngineGateway().shoutouts.useEnqueueRequest();
}

export function useRemoveShoutoutRequest() {
  return useEngineGateway().shoutouts.useRemoveRequest();
}

export function useReorderShoutoutsRequest() {
  return useEngineGateway().shoutouts.useReorderRequest();
}
