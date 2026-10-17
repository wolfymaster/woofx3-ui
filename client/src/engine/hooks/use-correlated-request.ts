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

/** Sends requests of one kind under fresh correlation keys and follows the answer to the latest. */
export function useCorrelatedRequest<Kind extends CorrelatedRequestKind>(kind: Kind, instanceId: InstanceId | null) {
  return useEngineGateway().requests.useCorrelated(kind, instanceId);
}
