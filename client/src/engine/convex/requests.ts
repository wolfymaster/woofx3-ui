import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useConvex, useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import type { RequestsGateway } from "@/engine/gateway";
import { failureForCurrentRequest } from "@/engine/hooks/correlated-failure";
import type {
  Correlated,
  CorrelatedFailure,
  CorrelatedRequestKind,
  CorrelatedRequests,
  EventWatch,
  InstanceId,
  TransientEvent,
} from "@/engine/types";
import { fromInstanceId } from "./ids";
import { useMappedList, useMappedValue } from "./mapped";

function toTransientEvent(row: Doc<"transientEvents">): TransientEvent {
  return {
    correlationKey: row.correlationKey,
    type: row.type,
    status: row.status,
    message: row.message,
    data: row.data,
    expiresAt: row.expiresAt,
  };
}

function toLiveTransientEvent(row: Doc<"transientEvents"> | null | undefined): TransientEvent | null | undefined {
  return row === undefined || row === null ? row : toTransientEvent(row);
}

// Every correlated request kind is a Convex action taking the instance, the
// request and the key the engine answers under.
const DISPATCH = {
  fieldOptions: api.fieldOptions.dispatch,
} as const satisfies Record<CorrelatedRequestKind, unknown>;

function useEvent(instanceId: InstanceId | null, correlationKey: string | null) {
  const row = useQuery(
    api.transientEvents.get,
    instanceId && correlationKey !== null ? { instanceId: fromInstanceId(instanceId), correlationKey } : "skip"
  );
  return useMappedValue(row, toTransientEvent);
}

function useEvents(instanceId: InstanceId | null, correlationKey: string | null) {
  const rows = useQuery(
    api.transientEvents.listByCorrelation,
    instanceId && correlationKey !== null ? { instanceId: fromInstanceId(instanceId), correlationKey } : "skip"
  );
  return useMappedList(rows, toTransientEvent);
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
      dispatch({ instanceId: fromInstanceId(instanceId), reference: request, correlationKey: key }).catch(
        (error: unknown) => {
          setFailure({ correlationKey: key, error });
        }
      );
    },
    [instanceId, dispatch]
  );

  const clear = useCallback(() => setCorrelationKey(null), []);

  const event = useEvent(instanceId, correlationKey);
  const currentFailure = useMemo(() => failureForCurrentRequest(failure, correlationKey), [failure, correlationKey]);

  return { correlationKey, start, clear, event, failure: currentFailure };
}

function useSendRequest(kind: CorrelatedRequestKind) {
  const dispatch = useAction(DISPATCH[kind]);
  return useCallback(
    (instanceId: InstanceId, request: CorrelatedRequests[CorrelatedRequestKind], correlationKey: string) =>
      dispatch({ instanceId: fromInstanceId(instanceId), reference: request, correlationKey }),
    [dispatch]
  );
}

function useEventWatchRequest() {
  const convex = useConvex();
  return useCallback(
    (instanceId: InstanceId, correlationKey: string): EventWatch => {
      const watch = convex.watchQuery(api.transientEvents.get, {
        instanceId: fromInstanceId(instanceId),
        correlationKey,
      });
      return {
        current: () => toLiveTransientEvent(watch.localQueryResult()),
        onUpdate: (onChange) => watch.onUpdate(onChange),
      };
    },
    [convex]
  );
}

export const convexRequestsGateway: RequestsGateway = {
  useEvent,
  useEvents,
  useCorrelated,
  useSendRequest,
  useEventWatchRequest,
};
