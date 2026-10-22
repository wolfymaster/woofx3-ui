import type { CallbackEnvelope, EngineEventFrame, EngineEventSubscriber, RequestEnvelope } from "@woofx3/api";
import { RpcTarget } from "@woofx3/api/client";
import type { Logger } from "@/lib/engine-session/deps";

/** Where the sink sends what the stream delivers. */
export interface EngineEventRoutes {
  event(envelope: CallbackEnvelope): void;
  request(envelope: RequestEnvelope): void;
  /**
   * Frames may have been missed: `seq` skipped ahead, or arrived invalid or
   * out of order. Whatever the client shows may be stale.
   */
  missed(): void;
  /** The engine released its hold on the sink: no further frame will arrive on this subscription. */
  ended(): void;
}

/**
 * The subscriber one session passes to `subscribeEngineEvents`. capnweb
 * exports it by reference and the engine holds the stub past the call, so the
 * session keeps this instance for as long as it lives. A new session needs a
 * new sink: `seq` starts again at 1 for every subscription.
 *
 * The engine waits for each `onEngineEvent` before pushing the next frame and
 * ends the subscription on a rejection, so it never rejects and never waits
 * on the routes: a failing route is logged with the frame and the stream goes
 * on.
 *
 * The engine holds the sink's stub for the life of the subscription, not of
 * the session: it drops a subscriber whose push rejects or outlasts its push
 * timeout, and expects the client to subscribe again. capnweb tells the sink
 * by calling its `Symbol.dispose` once every remote stub of it is released.
 */
export class EngineEventSink extends RpcTarget implements EngineEventSubscriber {
  private lastSeq = 0;
  /** Recent event ids, oldest first, to drop an event the engine delivers twice. */
  private readonly seen = new Set<string>();

  constructor(
    private readonly routes: EngineEventRoutes,
    private readonly logger: Logger,
    private readonly seenLimit: number
  ) {
    super();
  }

  async onEngineEvent(frame: EngineEventFrame): Promise<void> {
    try {
      this.lastSeq = checkSeq(this.lastSeq, frame.seq, this.routes, this.logger);
      switch (frame.kind) {
        case "event": {
          if (this.seen.has(frame.envelope.id)) {
            return;
          }
          this.seen.add(frame.envelope.id);
          if (this.seen.size > this.seenLimit) {
            const [oldest] = this.seen;
            this.seen.delete(oldest);
          }
          this.routes.event(frame.envelope);
          return;
        }
        case "request": {
          this.routes.request(frame.envelope);
          return;
        }
        default: {
          const unknown: never = frame;
          this.logger.warn("EngineEventSink: dropped a frame of unknown kind", { frame: unknown });
          return;
        }
      }
    } catch (error) {
      this.logger.error("EngineEventSink: handling a frame failed", {
        seq: frame.seq,
        kind: frame.kind,
        id: frame.envelope?.id,
        error,
      });
    }
  }

  [Symbol.dispose](): void {
    try {
      this.routes.ended();
    } catch (error) {
      this.logger.error("EngineEventSink: handling the end of the subscription failed", { error });
    }
  }
}

/**
 * The count after `seq`. `seq` rises by one per frame due to the
 * subscription, so a skip means frames were dropped. The engine also counts a
 * queued request it skipped because its caller stopped waiting, so a skip can
 * be harmless; it is still read as a gap, since the two cannot be told apart
 * here and a resync is only wasted work. A `seq` that is not an integer above
 * the last one breaks the protocol: it is logged, read as a gap, and does not
 * move the count back.
 *
 * A function rather than a method: every method of an RpcTarget can be called
 * by the peer.
 */
function checkSeq(last: number, seq: number, routes: EngineEventRoutes, logger: Logger): number {
  if (!Number.isInteger(seq) || seq <= last) {
    logger.warn("EngineEventSink: frame with an invalid seq", { last, received: seq });
    routes.missed();
    return last;
  }
  if (seq !== last + 1) {
    logger.warn("EngineEventSink: frames were dropped", { expected: last + 1, received: seq });
    routes.missed();
  }
  return seq;
}
