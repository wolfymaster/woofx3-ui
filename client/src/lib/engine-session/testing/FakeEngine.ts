import {
  type ApiGatewayContract,
  type CallbackEnvelope,
  ENGINE_CAPABILITIES_SCHEMA,
  type EngineCapabilities,
  type EngineEventFrame,
  type EngineEventMessage,
  type EngineEventSubscriber,
  type EngineRequestAnswer,
  type PingResponse,
  type RequestEnvelope,
  supportedEngineCapabilities,
  type Woofx3EngineApi,
} from "@woofx3/api";
import { type EngineBrowserSession, RpcTarget } from "@woofx3/api/client";
import type { EngineTarget } from "../target";

// capnweb recognises an RpcTarget only by its own copy's class, and
// `@woofx3/api/client` builds sessions with whichever copy the package
// resolves, which is also the `RpcTarget` it re-exports. Both halves of the
// fake run on that copy, or a target passed across would not serialize. The
// package exports no MessagePort session, so `capnweb` is resolved the way
// the package resolves it, wherever its dependencies are installed.
const { newMessagePortRpcSession }: typeof import("capnweb") = await import(
  import.meta.resolve("capnweb", import.meta.resolve("@woofx3/api/client"))
);

/** The engine methods the fake serves. Typed against the real contract, so drift is a compile error. */
type FakeEngineSurface = Pick<
  Woofx3EngineApi,
  "ping" | "getEngineCapabilities" | "subscribeEngineEvents" | "answerEngineRequest"
>;

interface Subscription {
  subscriber: EngineEventSubscriber;
  seq: number;
}

class FakeApi extends RpcTarget implements FakeEngineSurface {
  subscription: Subscription | null = null;

  constructor(private readonly engine: FakeEngine) {
    super();
  }

  async ping(): Promise<PingResponse> {
    await this.engine.answering("ping");
    return { status: "ok" };
  }

  async getEngineCapabilities(): Promise<EngineCapabilities> {
    await this.engine.answering("getEngineCapabilities");
    return { schema: ENGINE_CAPABILITIES_SCHEMA, capabilities: [...this.engine.capabilities] };
  }

  async subscribeEngineEvents(callback: EngineEventSubscriber): Promise<void> {
    // capnweb disposes a stub received as a parameter when the call returns;
    // the engine keeps a duplicate for later pushes, and so does the fake.
    const held = (callback as EngineEventSubscriber & { dup(): EngineEventSubscriber }).dup();
    this.subscription = { subscriber: held, seq: 0 };
    this.engine.subscribeCalls += 1;
  }

  async answerEngineRequest(requestId: string, answer: EngineRequestAnswer): Promise<void> {
    this.engine.answers.push({ requestId, answer });
  }
}

class FakeGateway extends RpcTarget {
  constructor(private readonly engine: FakeEngine) {
    super();
  }

  authenticate(clientId: string, clientSecret: string): FakeApi {
    if (clientId !== this.engine.clientId || clientSecret !== this.engine.clientSecret) {
      // The engine's own refusal, word for word (woofx3 api/src/gateway.ts).
      throw new Error("Invalid client credentials");
    }
    const api = new FakeApi(this.engine);
    this.engine.sessions.push(api);
    return api;
  }
}

/**
 * An in-memory engine reached over real capnweb on a `MessageChannel`: the
 * same serialization, stub export and disposal as the WebSocket, with no
 * socket and no engine build, so it runs anywhere the tests do.
 */
export class FakeEngine {
  readonly url = "http://engine.test";
  readonly clientId = "fake-client";
  clientSecret = "ab".repeat(32);
  capabilities: string[] = supportedEngineCapabilities("local");
  /** False makes every new session break before it answers, as an engine that is down does. */
  reachable = true;
  /** Methods that never answer, as an engine that hangs does. */
  readonly unanswered = new Set<keyof FakeEngineSurface>();
  readonly answers: Array<{ requestId: string; answer: EngineRequestAnswer }> = [];
  readonly sessions: FakeApi[] = [];
  sessionsOpened = 0;
  subscribeCalls = 0;
  private readonly serverPorts: MessagePort[] = [];

  /** Resolves when `method` may answer: never, while it is unanswered. */
  answering(method: keyof FakeEngineSurface): Promise<void> {
    return this.unanswered.has(method) ? new Promise<void>(() => {}) : Promise.resolve();
  }

  target(): EngineTarget {
    return { url: this.url, clientId: this.clientId, clientSecret: this.clientSecret };
  }

  /** Opens a client session the way `createEngineBrowserSession` does, against this engine. */
  readonly open = <Api>(target: EngineTarget): EngineBrowserSession<Api> => {
    this.sessionsOpened += 1;
    const channel = new MessageChannel();
    if (this.reachable) {
      newMessagePortRpcSession(channel.port1, new FakeGateway(this));
      this.serverPorts.push(channel.port1);
    } else {
      channel.port1.postMessage(null);
    }
    const gateway = newMessagePortRpcSession<ApiGatewayContract>(channel.port2);
    const stub = gateway as unknown as {
      [Symbol.dispose](): void;
      onRpcBroken(callback: (error: unknown) => void): void;
    };
    return {
      api: gateway.authenticate(target.clientId, target.clientSecret) as unknown as Api,
      gateway,
      dispose: () => stub[Symbol.dispose](),
      onBroken: (callback) => stub.onRpcBroken(callback),
    };
  };

  async pushEvent(envelope: CallbackEnvelope): Promise<void> {
    await this.push({ kind: "event", envelope });
  }

  async pushRequest(envelope: RequestEnvelope): Promise<void> {
    await this.push({ kind: "request", envelope });
  }

  /** Counts `count` frames as due without delivering them, as the engine does when a subscriber falls behind. */
  dropFrames(count: number): void {
    for (const subscription of this.subscriptions()) {
      subscription.seq += count;
    }
  }

  /**
   * Ends every subscription and releases its held stub while the sessions
   * stay open, as the engine does with a subscriber whose push rejects or
   * times out.
   */
  dropSubscriptions(): void {
    for (const api of this.sessions) {
      const held = api.subscription?.subscriber as Partial<Disposable> | undefined;
      api.subscription = null;
      held?.[Symbol.dispose]?.();
    }
  }

  /** Closes every session from the engine's side, as a restart does. */
  breakSessions(): void {
    for (const port of this.serverPorts.splice(0)) {
      port.postMessage(null);
      port.close();
    }
    this.sessions.length = 0;
  }

  private async push(message: EngineEventMessage): Promise<void> {
    for (const subscription of this.subscriptions()) {
      subscription.seq += 1;
      const frame: EngineEventFrame = { ...message, seq: subscription.seq };
      await subscription.subscriber.onEngineEvent(frame);
    }
  }

  private subscriptions(): Subscription[] {
    return this.sessions.flatMap((api) => (api.subscription ? [api.subscription] : []));
  }
}
