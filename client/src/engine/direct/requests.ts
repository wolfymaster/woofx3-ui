import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { RequestsGateway } from "@/engine/gateway";
import { failureForCurrentRequest } from "@/engine/hooks/correlated-failure";
import { NoInstanceSelectedError, useEngineScope } from "@/engine/scope";
import type {
  Correlated,
  CorrelatedFailure,
  CorrelatedRequestKind,
  CorrelatedRequests,
  EventWatch,
  Live,
  TransientEvent,
} from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

type Dispatch<Kind extends CorrelatedRequestKind> = (
  runtime: DirectRuntime,
  request: CorrelatedRequests[Kind],
  correlationKey: string
) => Promise<void>;

/** How each correlated request kind reaches the engine; its answer arrives as a transient event under the key. */
const DISPATCH: { readonly [Kind in CorrelatedRequestKind]: Dispatch<Kind> } = {
  fieldOptions: async (runtime, reference, correlationKey) => {
    await runtime.call("dispatchFieldOptionsRequest", (api) =>
      api.dispatchFieldOptionsRequest(reference, correlationKey)
    );
  },
};

/**
 * Transient events come from the engine's event stream into the runtime's
 * store, which keeps them for as long as the Convex gateway's table does.
 * The stream delivers at most once, so an answer pushed while disconnected
 * never arrives, and the key reads null as if it were still coming.
 */
export function directRequestsGateway(runtime: DirectRuntime): RequestsGateway {
  const transients = runtime.connection.transients;

  const useEvent = (correlationKey: string | null): Live<TransientEvent | null> => {
    const { instanceId } = useEngineScope();
    return useSyncExternalStore(transients.subscribe, () =>
      instanceId === null || correlationKey === null ? undefined : transients.latest(correlationKey)
    );
  };

  const useEvents = (correlationKey: string | null): Live<TransientEvent[]> => {
    const { instanceId } = useEngineScope();
    const events = useSyncExternalStore(transients.subscribe, () =>
      instanceId === null || correlationKey === null ? undefined : transients.events(correlationKey)
    );
    // The store's list is replaced on every change, so the copy changes with it.
    return useMemo(() => (events === undefined ? undefined : [...events]), [events]);
  };

  function useCorrelated<Kind extends CorrelatedRequestKind>(kind: Kind): Correlated<CorrelatedRequests[Kind]> {
    const { instanceId } = useEngineScope();
    const [correlationKey, setCorrelationKey] = useState<string | null>(null);
    const [failure, setFailure] = useState<CorrelatedFailure | null>(null);

    const start = useCallback(
      (request: CorrelatedRequests[Kind]) => {
        if (instanceId === null) {
          throw new NoInstanceSelectedError();
        }
        const key = crypto.randomUUID();
        setCorrelationKey(key);
        DISPATCH[kind](runtime, request, key).catch((error: unknown) => {
          setFailure({ correlationKey: key, error });
        });
      },
      [instanceId, kind, runtime]
    );

    const clear = useCallback(() => setCorrelationKey(null), []);
    const event = useEvent(correlationKey);
    const currentFailure = useMemo(() => failureForCurrentRequest(failure, correlationKey), [failure, correlationKey]);

    return { correlationKey, start, clear, event, failure: currentFailure };
  }

  function useSendRequest<Kind extends CorrelatedRequestKind>(kind: Kind) {
    const send = useCallback(
      async (request: CorrelatedRequests[Kind], correlationKey: string) => {
        await DISPATCH[kind](runtime, request, correlationKey);
        return { correlationKey };
      },
      [kind, runtime]
    );
    return useEngineRequest(send);
  }

  const watch = (correlationKey: string): EventWatch => ({
    current: () => transients.latest(correlationKey),
    onUpdate: (onChange) => transients.subscribe(onChange),
  });

  return {
    useEvent,
    useEvents,
    useCorrelated,
    useSendRequest,
    useEventWatchRequest: () => {
      const { instanceId } = useEngineScope();
      return useCallback(
        (correlationKey: string) => {
          if (instanceId === null) {
            throw new NoInstanceSelectedError();
          }
          return watch(correlationKey);
        },
        [instanceId]
      );
    },
  };
}
