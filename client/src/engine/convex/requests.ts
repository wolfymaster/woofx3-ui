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
  TransientEvent,
} from "@/engine/types";
import { systemClock } from "@/lib/engine-session/system";
import { requireInstance, useInstanceAction, useScopeInstanceId } from "./scope";

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

/**
 * The rows still live at `now`. The server keeps an expired row until its
 * sweep deletes it, up to a minute late, and cannot filter it out itself: a
 * Convex query must not read the clock.
 */
export function liveTransientEvents(rows: Doc<"transientEvents">[], now: number): TransientEvent[] {
  return rows.filter((row) => row.expiresAt > now).map(toTransientEvent);
}

function toLiveTransientEvent(row: Doc<"transientEvents"> | null | undefined): TransientEvent | null | undefined {
  if (row === undefined || row === null) {
    return row;
  }
  return liveTransientEvents([row], systemClock.now())[0] ?? null;
}

// Every correlated request kind is a Convex action taking the instance, the
// request and the key the engine answers under.
const DISPATCH = {
  fieldOptions: api.fieldOptions.dispatch,
} as const satisfies Record<CorrelatedRequestKind, unknown>;

function useEvent(correlationKey: string | null) {
  const instanceId = useScopeInstanceId();
  const row = useQuery(
    api.transientEvents.get,
    instanceId && correlationKey !== null ? { instanceId, correlationKey } : "skip"
  );
  return useMemo(() => toLiveTransientEvent(row), [row]);
}

function useEvents(correlationKey: string | null) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(
    api.transientEvents.listByCorrelation,
    instanceId && correlationKey !== null ? { instanceId, correlationKey } : "skip"
  );
  return useMemo(() => (rows === undefined ? undefined : liveTransientEvents(rows, systemClock.now())), [rows]);
}

function useCorrelated(kind: CorrelatedRequestKind): Correlated<CorrelatedRequests[CorrelatedRequestKind]> {
  const dispatch = useAction(DISPATCH[kind]);
  const instanceId = useScopeInstanceId();
  const [correlationKey, setCorrelationKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<CorrelatedFailure | null>(null);

  const start = useCallback(
    (request: CorrelatedRequests[CorrelatedRequestKind]) => {
      const scoped = requireInstance(instanceId);
      const key = crypto.randomUUID();
      setCorrelationKey(key);
      dispatch({ instanceId: scoped, reference: request, correlationKey: key }).catch((error: unknown) => {
        setFailure({ correlationKey: key, error });
      });
    },
    [instanceId, dispatch]
  );

  const clear = useCallback(() => setCorrelationKey(null), []);

  const event = useEvent(correlationKey);
  const currentFailure = useMemo(() => failureForCurrentRequest(failure, correlationKey), [failure, correlationKey]);

  return { correlationKey, start, clear, event, failure: currentFailure };
}

function useSendRequest(kind: CorrelatedRequestKind) {
  const dispatch = useInstanceAction(DISPATCH[kind]);
  return useCallback(
    (request: CorrelatedRequests[CorrelatedRequestKind], correlationKey: string) =>
      dispatch({ reference: request, correlationKey }),
    [dispatch]
  );
}

function useEventWatchRequest() {
  const convex = useConvex();
  const instanceId = useScopeInstanceId();
  return useCallback(
    (correlationKey: string): EventWatch => {
      const watch = convex.watchQuery(api.transientEvents.get, {
        instanceId: requireInstance(instanceId),
        correlationKey,
      });
      return {
        current: () => toLiveTransientEvent(watch.localQueryResult()),
        onUpdate: (onChange) => watch.onUpdate(onChange),
      };
    },
    [convex, instanceId]
  );
}

export const convexRequestsGateway: RequestsGateway = {
  useEvent,
  useEvents,
  useCorrelated,
  useSendRequest,
  useEventWatchRequest,
};
