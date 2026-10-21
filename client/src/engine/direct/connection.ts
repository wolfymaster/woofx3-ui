import { type CallbackEnvelope, ENGINE_CAPABILITIES, type RequestEnvelope, type Woofx3EngineApi } from "@woofx3/api";
import type { RpcTarget } from "@woofx3/api/client";
import type { Clock, Logger, Random } from "@/lib/engine-session/deps";
import { EngineSession, type OpenEngineSession } from "@/lib/engine-session/EngineSession";
import type { EngineTargetSource } from "@/lib/engine-session/target";
import { type DirectGatewayConfig, validateDirectGatewayConfig } from "./config";
import { EngineEventSink } from "./EngineEventSink";
import { answerFor } from "./request-answers";
import { TransientEventStore } from "./TransientEventStore";

/** The engine's whole RPC surface, with no local additions: a method the engine lacks is an engine change. */
export type DirectEngineApi = RpcTarget & Woofx3EngineApi;

/**
 * Without the event stream nothing would tell the gateway that what it read
 * has changed, and it would show stale data without knowing, so an engine
 * without it is refused.
 */
const DIRECT_REQUIRED_CAPABILITIES = [ENGINE_CAPABILITIES.engineEventStream] as const;

/**
 * Why everything read from the engine may be stale: a new session (whatever
 * happened while disconnected was missed), dropped frames, or a different
 * engine or credentials altogether.
 */
export type ResyncReason = "connected" | "gap" | "retargeted";

export interface DirectConnectionDeps {
  /** Supplies the engine URL and client credentials; where they come from is the host's choice. */
  targets: EngineTargetSource;
  open: OpenEngineSession<DirectEngineApi>;
  clock: Clock;
  random: Random;
  logger: Logger;
  config: DirectGatewayConfig;
}

/** The live half of the direct gateway: one engine session, its held event stream, and what the stream feeds. */
export interface DirectConnection {
  readonly session: EngineSession<DirectEngineApi>;
  readonly transients: TransientEventStore;
  /** Calls `listener` with every engine event, once per envelope id; returns the unsubscribe. */
  onEvent(listener: (envelope: CallbackEnvelope) => void): () => void;
  /** Calls `listener` whenever anything read from the engine may be stale; returns the unsubscribe. */
  onResync(listener: (reason: ResyncReason) => void): () => void;
}

export function createDirectConnection(deps: DirectConnectionDeps): DirectConnection {
  const { clock, logger, config } = deps;
  validateDirectGatewayConfig(config);
  const transients = new TransientEventStore(clock, { ttlMs: config.transientTtlMs, perKey: config.transientsPerKey });
  const eventListeners = new Set<(envelope: CallbackEnvelope) => void>();
  const resyncListeners = new Set<(reason: ResyncReason) => void>();

  const resync = (reason: ResyncReason): void => {
    for (const listener of resyncListeners) {
      listener(reason);
    }
  };

  // Answered without awaiting: the engine pushes nothing more on the stream
  // until onEngineEvent returns, and the answer is a call of its own.
  const answer = (envelope: RequestEnvelope): void => {
    const reply = answerFor(envelope, logger);
    session
      .call("answerEngineRequest", (api) => api.answerEngineRequest(envelope.id, reply))
      .catch((error: unknown) => {
        logger.warn("DirectConnection: could not answer an engine request", {
          id: envelope.id,
          type: envelope.type,
          error,
        });
      });
  };

  const session = new EngineSession<DirectEngineApi>({
    targets: deps.targets,
    open: deps.open,
    required: DIRECT_REQUIRED_CAPABILITIES,
    clock,
    random: deps.random,
    logger,
    config: config.session,
    hooks: {
      attach: async (api) => {
        // capnweb exports the sink by reference, and its export table keeps
        // the sink alive while the engine holds the stub, which it does for
        // the life of the session.
        const sink = new EngineEventSink(
          {
            event: (envelope) => {
              transients.ingest(envelope);
              for (const listener of eventListeners) {
                listener(envelope);
              }
            },
            request: answer,
            gap: () => resync("gap"),
          },
          logger,
          config.seenEnvelopeIds
        );
        // Every event and every request; a second subscribe on this session
        // would replace this one, so each session subscribes exactly once.
        await api.subscribeEngineEvents(sink);
        resync("connected");
      },
      retargeted: () => {
        transients.clear();
        resync("retargeted");
      },
    },
  });

  return {
    session,
    transients,
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    onResync: (listener) => {
      resyncListeners.add(listener);
      return () => {
        resyncListeners.delete(listener);
      };
    },
  };
}
