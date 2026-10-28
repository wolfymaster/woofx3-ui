import { type QueryKey, useQuery } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { EngineDisconnectedError } from "@/engine/errors";
import { NoInstanceSelectedError, useEngineScope } from "@/engine/scope";
import type { Live } from "@/engine/types";
import type { DirectRuntime } from "./runtime";

/** One cached read: where it is kept and how it is read from the engine. */
export interface EngineRead<T> {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
}

export interface EngineQueryOptions<T, Selected> {
  /** False reads nothing and stays loading. */
  enabled?: boolean;
  /** Derives what the caller gets from the cached value; must be module-level so its result keeps its identity. */
  select?: (data: T) => Selected;
}

/** True while the runtime's session has completed an authenticated round trip. */
export function useConnected(runtime: DirectRuntime): boolean {
  const session = runtime.connection.session;
  return useSyncExternalStore(session.subscribe, () => session.state.status === "connected");
}

/**
 * A subscribed read from the runtime's cache. It stays loading while the
 * scope has no instance, and reads nothing while disconnected: what was read
 * before stays on screen, as a subscription that lost its server keeps its
 * last value. A failure on a live session throws to the nearest error
 * boundary; a session that drops mid-read never does, because the next
 * session reads again.
 */
export function useEngineQuery<T, Selected = T>(
  runtime: DirectRuntime,
  read: EngineRead<T>,
  options: EngineQueryOptions<T, Selected> = {}
): Live<Selected> {
  const { instanceId } = useEngineScope();
  const connected = useConnected(runtime);
  const { data } = useQuery(
    {
      queryKey: read.queryKey,
      queryFn: read.queryFn,
      select: options.select,
      enabled: instanceId !== null && connected && options.enabled !== false,
      throwOnError: (error) => !(error instanceof EngineDisconnectedError),
    },
    runtime.queryClient
  );
  return instanceId === null ? undefined : data;
}

/**
 * A request bound to the scope: it rejects with `NoInstanceSelectedError`
 * while the scope has none, and keeps its identity until the scope's
 * instance changes. `perform` must keep its identity across renders.
 */
export function useEngineRequest<Args extends unknown[], Result>(
  perform: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  const { instanceId } = useEngineScope();
  return useCallback(
    async (...args: Args) => {
      if (instanceId === null) {
        throw new NoInstanceSelectedError();
      }
      return perform(...args);
    },
    [instanceId, perform]
  );
}
