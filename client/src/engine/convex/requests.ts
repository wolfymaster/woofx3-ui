import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import type { RequestsGateway } from "@/engine/gateway";
import { failureForCurrentRequest } from "@/engine/hooks/correlated-failure";
import type {
  Correlated,
  CorrelatedFailure,
  CorrelatedRequestKind,
  CorrelatedRequests,
  InstanceId,
} from "@/engine/types";

// Every correlated request kind is a Convex action taking the instance, the
// request and the key the engine answers under.
const DISPATCH = {
  fieldOptions: api.fieldOptions.dispatch,
} as const satisfies Record<CorrelatedRequestKind, unknown>;

function useEvent(instanceId: InstanceId | null, correlationKey: string | null) {
  return useQuery(
    api.transientEvents.get,
    instanceId && correlationKey !== null ? { instanceId, correlationKey } : "skip"
  );
}

function useEvents(instanceId: InstanceId | null, correlationKey: string | null) {
  return useQuery(
    api.transientEvents.listByCorrelation,
    instanceId && correlationKey !== null ? { instanceId, correlationKey } : "skip"
  );
}

function useCorrelated(
  kind: CorrelatedRequestKind,
  instanceId: InstanceId | null
): Correlated<CorrelatedRequests[CorrelatedRequestKind]> {
  const dispatch = useAction(DISPATCH[kind]);
  const [correlationKey, setCorrelationKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<CorrelatedFailure | null>(null);

  const start = useCallback(
    (request: CorrelatedRequests[CorrelatedRequestKind]) => {
      if (!instanceId) {
        throw new Error("useCorrelated: start needs an instance");
      }
      const key = crypto.randomUUID();
      setCorrelationKey(key);
      dispatch({ instanceId, reference: request, correlationKey: key }).catch((error: unknown) => {
        setFailure({ correlationKey: key, error });
      });
    },
    [instanceId, dispatch]
  );

  const clear = useCallback(() => setCorrelationKey(null), []);

  const event = useEvent(instanceId, correlationKey);
  const currentFailure = useMemo(() => failureForCurrentRequest(failure, correlationKey), [failure, correlationKey]);

  return { correlationKey, start, clear, event, failure: currentFailure };
}

export const convexRequestsGateway: RequestsGateway = {
  useEvent,
  useEvents,
  useCorrelated,
};
