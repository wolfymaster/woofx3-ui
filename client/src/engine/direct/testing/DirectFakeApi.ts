import type {
  AlertListPage,
  AlertListQuery,
  AlertSnapshot,
  CommandSnapshot,
  CreateCommandInput,
  FieldOptionsReference,
  PaginatedStreamSessions,
  StreamEventFrame,
  StreamEventSubscriber,
  StreamSession,
  StreamStatus,
  Woofx3EngineApi,
} from "@woofx3/api";
import { FakeApi, type FakeEngine } from "@/lib/engine-session/testing/FakeEngine";

/** The engine methods the direct gateway's tests serve beyond every session's. */
type DirectFakeSurface = Pick<
  Woofx3EngineApi,
  | "listCommands"
  | "createCommand"
  | "getStreamStatus"
  | "listStreamSessions"
  | "listAlerts"
  | "subscribeStreamEvents"
  | "dispatchFieldOptionsRequest"
>;

interface StreamSubscription {
  subscriber: StreamEventSubscriber;
  types: readonly string[] | null;
}

/** What the fake engine holds, shared by every session a test opens. */
export class FakeEngineState {
  commands: CommandSnapshot[] = [];
  alerts: AlertSnapshot[] = [];
  streamStatus: StreamStatus = { isLive: false, uptime: "", viewerCount: 0 };
  sessions: StreamSession[] = [];
  /** Every call the fake served, by method, with its arguments. */
  readonly calls: Array<{ method: keyof DirectFakeSurface; args: unknown[] }> = [];
  /** The latest stream subscription of each session, in the order they were made. */
  readonly streamSubscriptions: StreamSubscription[] = [];

  record(method: keyof DirectFakeSurface, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  callsOf(method: keyof DirectFakeSurface): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }

  /** Pushes `frame` to the latest stream subscription, as the engine pushes to the one a session holds. */
  async pushStreamEvent(frame: StreamEventFrame): Promise<void> {
    const subscription = this.streamSubscriptions.at(-1);
    if (subscription === undefined) {
      throw new Error("no stream subscription to push to");
    }
    await subscription.subscriber.onStreamEvent(frame);
  }
}

/** A session's API serving the direct gateway's reads from `FakeEngineState`. */
export class DirectFakeApi extends FakeApi implements DirectFakeSurface {
  constructor(
    engine: FakeEngine,
    private readonly state: FakeEngineState
  ) {
    super(engine);
  }

  async listCommands(): Promise<CommandSnapshot[]> {
    this.state.record("listCommands");
    await this.engine.answering("listCommands");
    return this.state.commands;
  }

  async createCommand(data: CreateCommandInput): Promise<CommandSnapshot> {
    this.state.record("createCommand", data);
    const created: CommandSnapshot = {
      id: `command-${this.state.commands.length + 1}`,
      command: data.command,
      actions: data.actions ?? [],
      workflowId: "",
      steps: data.steps ?? [],
      workflowError: "",
      cooldown: data.cooldown,
      priority: data.priority ?? 0,
      enabled: data.enabled,
      visibility: data.visibility,
      groupIds: data.groupIds ?? [],
      usernames: data.usernames ?? [],
      argumentPattern: data.argumentPattern ?? "",
    };
    this.state.commands = [...this.state.commands, created];
    return created;
  }

  async getStreamStatus(): Promise<StreamStatus> {
    this.state.record("getStreamStatus");
    return this.state.streamStatus;
  }

  async listStreamSessions(): Promise<PaginatedStreamSessions> {
    this.state.record("listStreamSessions");
    return { sessions: this.state.sessions.slice(0, 1), total: this.state.sessions.length, limit: 1, offset: 0 };
  }

  async listAlerts(query?: AlertListQuery): Promise<AlertListPage> {
    this.state.record("listAlerts", query);
    const limit = query?.limit ?? 50;
    return { alerts: this.state.alerts.slice(0, limit), totalCount: this.state.alerts.length, limit, offset: 0 };
  }

  async subscribeStreamEvents(callback: StreamEventSubscriber, types?: string[]): Promise<void> {
    this.state.record("subscribeStreamEvents", types);
    // capnweb disposes a stub received as a parameter when the call returns;
    // the engine keeps a duplicate for later pushes, and so does the fake.
    const held = (callback as StreamEventSubscriber & { dup(): StreamEventSubscriber }).dup();
    this.state.streamSubscriptions.push({ subscriber: held, types: types ?? null });
  }

  async dispatchFieldOptionsRequest(
    reference: FieldOptionsReference,
    correlationKey: string
  ): Promise<{ dispatched: boolean }> {
    this.state.record("dispatchFieldOptionsRequest", reference, correlationKey);
    return { dispatched: true };
  }
}
