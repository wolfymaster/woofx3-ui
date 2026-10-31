import { QueryClient } from "@tanstack/react-query";
import type { EngineCapability } from "@woofx3/api";
import { EngineDisconnectedError, EngineTimeoutError, GatewayUnsupportedError } from "@/engine/errors";
import type { Clock, IdSource, Logger } from "@/lib/engine-session/deps";
import type { DirectGatewayConfig } from "./config";
import {
  createDirectConnection,
  type DirectConnection,
  type DirectConnectionDeps,
  type DirectEngineApi,
} from "./connection";
import { invalidatedBy } from "./invalidations";
import { StreamEventRegistry } from "./StreamEventRegistry";

export interface DirectRuntimeDeps extends DirectConnectionDeps {
  /**
   * Asks the engine at `url` to answer without credentials, resolving once it
   * has: what a connection test checks before any target exists.
   */
  ping(url: string): Promise<void>;
  /** Names what the gateway creates in the engine's local UI settings, such as a dashboard panel. */
  newId: IdSource;
}

/**
 * Everything the direct gateway's namespaces share: one live engine
 * connection, the one query cache it keeps current, and the stream-event
 * subscriptions it carries. A gateway is built once at boot around one
 * runtime.
 */
export interface DirectRuntime {
  readonly connection: DirectConnection;
  /**
   * The only cache of engine reads. Passed to every query explicitly rather
   * than provided through React context, so nothing outside the gateway can
   * read or fill it.
   */
  readonly queryClient: QueryClient;
  readonly streamEvents: StreamEventRegistry;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly config: DirectGatewayConfig;
  readonly newId: IdSource;
  /** Runs one RPC on the live session; see `EngineSession.call`. */
  call<T>(name: Extract<keyof DirectEngineApi, string>, invoke: (api: DirectEngineApi) => PromiseLike<T>): Promise<T>;
  /** `DirectRuntimeDeps.ping` with the session's connect deadline. */
  ping(url: string): Promise<void>;
  /** Whether the connected engine lists `capability`; false while disconnected. */
  supports(capability: EngineCapability): boolean;
  /** Connects and keeps the connection up until `stop`; does nothing while started. */
  start(): void;
  /** Disconnects, then resolves once the attempt in flight has settled. */
  stop(): Promise<void>;
}

export function createDirectRuntime(deps: DirectRuntimeDeps): DirectRuntime {
  const { clock, logger, config } = deps;
  const connection = createDirectConnection(deps);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Freshness comes from engine events and resyncs, never from age.
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // A dropped session is not the read's failure: the read runs again
        // once the next session resyncs. A read the engine cannot serve
        // fails the same way however often it is tried.
        retry: (failures, error) =>
          !(error instanceof EngineDisconnectedError) &&
          !(error instanceof GatewayUnsupportedError) &&
          failures < config.queryAttempts - 1,
      },
    },
  });
  const streamEvents = new StreamEventRegistry(connection.session, clock, logger, config.streamRegistrationDelayMs);

  connection.onEvent((envelope) => {
    const stale = invalidatedBy(envelope);
    if (stale === "everything") {
      logger.warn("DirectRuntime: an engine event of an unknown type; reading everything again", {
        type: envelope.type,
      });
      void queryClient.invalidateQueries();
      return;
    }
    for (const queryKey of stale) {
      void queryClient.invalidateQueries({ queryKey });
    }
  });
  connection.onResync((reason) => {
    if (reason === "retargeted") {
      // Another engine's, or other credentials' answers: none of it may show.
      void queryClient.resetQueries();
      return;
    }
    void queryClient.invalidateQueries();
  });

  let stopStreamEvents: (() => void) | null = null;

  return {
    connection,
    queryClient,
    streamEvents,
    clock,
    logger,
    config,
    newId: deps.newId,
    call: (name, invoke) => connection.session.call(name, invoke),
    ping: (url) => withDeadline(clock, "ping", config.session.connectTimeoutMs, deps.ping(url)),
    supports: (capability) => {
      const state = connection.session.state;
      return state.status === "connected" && state.capabilities.includes(capability);
    },
    start: () => {
      if (stopStreamEvents !== null) {
        return;
      }
      stopStreamEvents = streamEvents.start();
      connection.session.start();
    },
    stop: async () => {
      stopStreamEvents?.();
      stopStreamEvents = null;
      // The cache is kept: a stop and a start in one commit (React's strict
      // mode mounts effects twice) must not drop what screens are showing,
      // and the next session reads everything again anyway.
      await connection.session.stop();
    },
  };
}

/** `work`, or `EngineTimeoutError` once `budgetMs` passes on `clock`. The work is abandoned, not cancelled. */
function withDeadline<T>(clock: Clock, operation: string, budgetMs: number, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = clock.schedule(budgetMs, () => reject(new EngineTimeoutError(operation, budgetMs)));
    work.then(
      (value) => {
        cancel();
        resolve(value);
      },
      (error: unknown) => {
        cancel();
        reject(error);
      }
    );
  });
}
