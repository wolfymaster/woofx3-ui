import { useEngineGateway } from "@/engine/context";
import type { CorrelatedRequestKind } from "@/engine/types";

/** The latest transient event under a key; a null key skips the read. */
export function useTransientEvent(correlationKey: string | null) {
  return useEngineGateway().requests.useEvent(correlationKey);
}

/** Every transient event under a key, oldest first; a null key skips the read. */
export function useTransientEvents(correlationKey: string | null) {
  return useEngineGateway().requests.useEvents(correlationKey);
}

/** Sends one request of a kind under the caller's key; the caller follows the answer. */
export function useSendCorrelatedRequest<Kind extends CorrelatedRequestKind>(kind: Kind) {
  return useEngineGateway().requests.useSendRequest(kind);
}

/** Follows the latest transient event under a key from outside a component. */
export function useTransientEventWatchRequest() {
  return useEngineGateway().requests.useEventWatchRequest();
}

/** Sends requests of one kind under fresh correlation keys and follows the answer to the latest. */
export function useCorrelatedRequest<Kind extends CorrelatedRequestKind>(kind: Kind) {
  return useEngineGateway().requests.useCorrelated(kind);
}
