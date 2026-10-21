import type { CallbackEnvelope, EngineEventFrame, EngineEventSubscriber, RequestEnvelope } from "@woofx3/api";
import { RpcTarget } from "@woofx3/api/client";
import type { Logger } from "@/lib/engine-session/deps";

/** Where the sink sends what the stream delivers. */
export interface EngineEventRoutes {
  event(envelope: CallbackEnvelope): void;
  request(envelope: RequestEnvelope): void;
  /** Frames were dropped between `expected` and `received`: whatever the client shows may be stale. */
  gap(expected: number, received: number): void;
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
      if (frame.seq !== this.lastSeq + 1) {
        this.logger.warn("EngineEventSink: frames were dropped", { expected: this.lastSeq + 1, received: frame.seq });
        this.routes.gap(this.lastSeq + 1, frame.seq);
      }
      this.lastSeq = frame.seq;
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
}
