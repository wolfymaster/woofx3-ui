import { useEngineGateway } from "@/engine/context";
import type { CorrelatedRequestKind, InstanceId } from "@/engine/types";

/** The latest transient event under a key; a null id or key skips the read. */
export function useTransientEvent(instanceId: InstanceId | null, correlationKey: string | null) {
  return useEngineGateway().requests.useEvent(instanceId, correlationKey);
}

/** Every transient event under a key, oldest first; a null id or key skips the read. */
export function useTransientEvents(instanceId: InstanceId | null, correlationKey: string | null) {
  return useEngineGateway().requests.useEvents(instanceId, correlationKey);
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
export function useCorrelatedRequest<Kind extends CorrelatedRequestKind>(kind: Kind, instanceId: InstanceId | null) {
  return useEngineGateway().requests.useCorrelated(kind, instanceId);
}
