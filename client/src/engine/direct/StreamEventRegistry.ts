import { ENGINE_CAPABILITIES, type StreamEventFrame, type StreamEventSubscriber } from "@woofx3/api";
import { RpcTarget } from "@woofx3/api/client";
import type { Cancel, Clock, Logger } from "@/lib/engine-session/deps";
import type { EngineSession, SessionState } from "@/lib/engine-session/EngineSession";
import { listenerTakes, type StreamListener, streamTypesUnion } from "@/lib/stream-listeners";
import type { DirectEngineApi } from "./connection";

/** What the registry registered on the current session: the sorted types it asked for, or the engine's fixed set. */
type Registration = { kind: "types"; key: string } | { kind: "fixed" };

/**
 * The subscriber handed to `subscribeStreamEvents`. capnweb exports it by
 * reference; the registry keeps the one it registered last, so the export
 * outlives the call.
 */
class StreamEventSink extends RpcTarget implements StreamEventSubscriber {
  constructor(private readonly deliver: (frame: StreamEventFrame) => void) {
    super();
  }

  async onStreamEvent(frame: StreamEventFrame): Promise<void> {
    this.deliver(frame);
  }
}

/**
 * The stream-event subscriptions of every screen, carried by one engine
 * subscription per session. The engine pushes the union of the types they
 * want, and each listener takes only its own.
 *
 * A session holds one registration, which every subscribe replaces, so the
 * union is registered again whenever it changes, debounced so a screen
 * mounting several listeners registers once, and again on every new session,
 * which starts with none. An engine without `events.log` pushes a fixed set
 * of types whatever it is asked for; it is registered once per session.
 *
 * Delivery has no replay: frames pushed while disconnected are gone, and a
 * listener that needs a full picture reads it again on reconnect.
 */
export class StreamEventRegistry {
  private readonly listeners = new Set<StreamListener>();
  private registration: Registration | null = null;
  private sink: StreamEventSink | null = null;
  private session: SessionState | null = null;
  private cancelRegistration: Cancel | null = null;

  constructor(
    private readonly engine: EngineSession<DirectEngineApi>,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly delayMs: number
  ) {}

  /** Follows the engine session, registering on each new one; returns the stop. */
  start(): () => void {
    const unsubscribe = this.engine.subscribe(() => this.sessionChanged());
    this.sessionChanged();
    return () => {
      unsubscribe();
      this.cancelRegistration?.();
      this.cancelRegistration = null;
    };
  }

  /** Adds a listener for `types` (null: every type the engine pushes); returns the unsubscribe. */
  subscribe(types: readonly string[] | null, onFrame: (frame: StreamEventFrame) => void): () => void {
    const listener: StreamListener = { types: types ? new Set(types) : null, callback: onFrame };
    this.listeners.add(listener);
    this.scheduleRegistration();
    return () => {
      this.listeners.delete(listener);
      this.scheduleRegistration();
    };
  }

  private sessionChanged(): void {
    const state = this.engine.state;
    if (state === this.session) {
      return;
    }
    this.session = state;
    // Each state object is one session's: a new connected state is a new
    // session, which holds no registration yet.
    this.registration = null;
    if (state.status === "connected") {
      this.register();
    }
  }

  private scheduleRegistration(): void {
    if (this.cancelRegistration !== null) {
      return;
    }
    this.cancelRegistration = this.clock.schedule(this.delayMs, () => {
      this.cancelRegistration = null;
      this.register();
    });
  }

  /**
   * Registers the listeners' union when it differs from what this session
   * holds. An empty union is registered too once anything was, so the engine
   * stops pushing types nobody listens to.
   */
  private register(): void {
    const state = this.engine.state;
    if (state.status !== "connected") {
      return;
    }
    const listeners = [...this.listeners];
    if (this.registration === null && listeners.length === 0) {
      return;
    }
    const perSubscriber = state.capabilities.includes(ENGINE_CAPABILITIES.eventsLog);
    const types = perSubscriber ? streamTypesUnion(listeners) : null;
    const next: Registration = types ? { kind: "types", key: types.join(",") } : { kind: "fixed" };
    if (
      this.registration !== null &&
      (this.registration.kind === "fixed" || sameRegistration(this.registration, next))
    ) {
      return;
    }
    this.registration = next;
    const sink = new StreamEventSink((frame) => this.deliver(frame));
    this.sink = sink;
    this.engine
      .call("subscribeStreamEvents", (api) =>
        types ? api.subscribeStreamEvents(sink, types) : api.subscribeStreamEvents(sink)
      )
      .catch((error: unknown) => {
        // Only the latest registration counts; one that replaced this one is
        // left alone, and a failed one is tried again on the next change.
        if (this.sink === sink && this.engine.state === state) {
          this.registration = null;
        }
        this.logger.warn("StreamEventRegistry: could not subscribe to stream events", { error });
      });
  }

  private deliver(frame: StreamEventFrame): void {
    for (const listener of this.listeners) {
      if (!listenerTakes(listener, frame.type)) {
        continue;
      }
      try {
        listener.callback(frame);
      } catch (error) {
        this.logger.error("StreamEventRegistry: a listener threw", { type: frame.type, error });
      }
    }
  }
}

function sameRegistration(a: Registration, b: Registration): boolean {
  return a.kind === "types" && b.kind === "types" && a.key === b.key;
}
