import type {
  AlertComposition,
  AlertListPage,
  AlertListQuery,
  AlertSnapshot,
  CommandSnapshot,
  CreateCommandInput,
  EngineModuleSummary,
  FieldOptionsReference,
  Leaderboard,
  LeaderboardQuery,
  PaginatedStreamSessions,
  PaginatedWorkflows,
  SceneSnapshot,
  StreamEventFrame,
  StreamEventSubscriber,
  StreamSession,
  StreamStatus,
  TriggerWorkflowOptions,
  TriggerWorkflowResponse,
  ViewerTotals,
  ViewerTotalsQuery,
  Woofx3EngineApi,
  Workflow,
  WorkflowCatalog,
  WorkflowHealth,
  WorkflowMutationResult,
  WorkflowRunDetail,
  WorkflowRunSnapshot,
  WorkflowRunSnapshotsQuery,
  WorkflowsQuery,
} from "@woofx3/api";
import type { WorkflowDefinition } from "@woofx3/api/workflow-definition";
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
  | "listAlertCompositions"
  | "getAlertComposition"
  | "createAlertComposition"
  | "getCompositionPreviewUrl"
  | "getLeaderboard"
  | "getStreamSessionGauges"
  | "getViewerTotals"
  | "listOverlayTokens"
  | "mintOverlayToken"
  | "rotateOverlayToken"
  | "listSceneSnapshots"
  | "getSceneSnapshot"
  | "getAvailableWidgets"
  | "listEngineModules"
  | "getWorkflows"
  | "getWorkflow"
  | "getWorkflowCatalog"
  | "createWorkflow"
  | "updateWorkflow"
  | "setWorkflowEnabled"
  | "triggerWorkflowByName"
  | "getWorkflowRun"
  | "getWorkflowHealth"
  | "listWorkflowRunSnapshots"
>;

export type AvailableWidget = Awaited<ReturnType<Woofx3EngineApi["getAvailableWidgets"]>>["widgets"][number];

type OverlayToken = Awaited<ReturnType<Woofx3EngineApi["listOverlayTokens"]>>[number];

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
  alertCompositions: AlertComposition[] = [];
  /** Null answers as an engine whose scene manager gave no preview. */
  compositionPreview: { url: string; expiresInSeconds: number } | null = null;
  /** Leaderboard entries by metric; a session id in `unknownSessions` answers null. */
  leaderboards: Record<string, Leaderboard["entries"]> = {};
  unknownSessions: string[] = [];
  /** Per-viewer totals keyed by `platformUserId` and, for one stream, `:sessionId`. */
  viewerTotals: Record<string, ViewerTotals> = {};
  overlayTokens: OverlayToken[] = [];
  scenes: SceneSnapshot[] = [];
  widgets: AvailableWidget[] = [];
  modules: EngineModuleSummary[] = [];
  workflows: Workflow[] = [];
  workflowCatalog: WorkflowCatalog = { triggers: [], actions: [], functions: [] };
  /** Recorded runs by execution id; an id not here answers null. */
  workflowRuns: Record<string, WorkflowRunDetail> = {};
  /** Every recorded run, newest first, as `listWorkflowRunSnapshots` lists them. */
  runSnapshots: WorkflowRunSnapshot[] = [];
  /** What `getWorkflowHealth` answers, or the error it throws. */
  workflowHealth: WorkflowHealth[] | Error = [];
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

  async listAlertCompositions(): Promise<{ compositions: AlertComposition[] }> {
    this.state.record("listAlertCompositions");
    return { compositions: this.state.alertCompositions };
  }

  async getAlertComposition(id: string): Promise<AlertComposition | null> {
    this.state.record("getAlertComposition", id);
    return this.state.alertCompositions.find((composition) => composition.id === id) ?? null;
  }

  async createAlertComposition(
    data: Parameters<Woofx3EngineApi["createAlertComposition"]>[0]
  ): Promise<{ id: string }> {
    this.state.record("createAlertComposition", data);
    const id = `alert-${this.state.alertCompositions.length + 1}`;
    this.state.alertCompositions = [
      ...this.state.alertCompositions,
      {
        id,
        name: data.name,
        description: data.description ?? "",
        widgetsJson: data.widgetsJson ?? "[]",
        layoutJson: data.layoutJson ?? "{}",
        behaviorsJson: data.behaviorsJson ?? "{}",
        inputsJson: data.inputsJson ?? "[]",
        hasDraft: false,
        createdByType: "USER",
        createdByRef: "",
      },
    ];
    return { id };
  }

  async getCompositionPreviewUrl(): Promise<{ url: string; expiresInSeconds: number } | null> {
    this.state.record("getCompositionPreviewUrl");
    return this.state.compositionPreview;
  }

  async getLeaderboard(query: LeaderboardQuery): Promise<Leaderboard | null> {
    this.state.record("getLeaderboard", query);
    if (query.sessionId !== undefined && this.state.unknownSessions.includes(query.sessionId)) {
      return null;
    }
    const entries = this.state.leaderboards[query.metric] ?? [];
    return { metric: query.metric, sessionId: query.sessionId ?? null, minTotal: query.minTotal ?? 1, entries };
  }

  async getStreamSessionGauges(sessionId: string): Promise<[]> {
    this.state.record("getStreamSessionGauges", sessionId);
    return [];
  }

  async getViewerTotals(query: ViewerTotalsQuery): Promise<ViewerTotals | null> {
    this.state.record("getViewerTotals", query);
    const key = query.sessionId === undefined ? query.platformUserId : `${query.platformUserId}:${query.sessionId}`;
    return this.state.viewerTotals[key] ?? null;
  }

  async listOverlayTokens(input?: { sceneId?: string }): Promise<OverlayToken[]> {
    this.state.record("listOverlayTokens", input);
    return this.state.overlayTokens.filter((token) => input?.sceneId === undefined || token.sceneId === input.sceneId);
  }

  async mintOverlayToken(input: { sceneId: string }): Promise<OverlayToken> {
    this.state.record("mintOverlayToken", input);
    return this.mint(input.sceneId);
  }

  async rotateOverlayToken(input: { tokenId: string }): Promise<OverlayToken> {
    this.state.record("rotateOverlayToken", input);
    const old = this.state.overlayTokens.find((token) => token.tokenId === input.tokenId);
    if (old === undefined) {
      throw new Error(`unknown overlay token ${input.tokenId}`);
    }
    old.status = "revoked";
    return this.mint(old.sceneId);
  }

  async listSceneSnapshots(): Promise<{ scenes: SceneSnapshot[] }> {
    this.state.record("listSceneSnapshots");
    return { scenes: this.state.scenes };
  }

  async getSceneSnapshot(id: string): Promise<SceneSnapshot | null> {
    this.state.record("getSceneSnapshot", id);
    return this.state.scenes.find((scene) => scene.id === id) ?? null;
  }

  async getAvailableWidgets(): Promise<{ widgets: AvailableWidget[] }> {
    this.state.record("getAvailableWidgets");
    return { widgets: this.state.widgets };
  }

  async listEngineModules(): Promise<EngineModuleSummary[]> {
    this.state.record("listEngineModules");
    return this.state.modules;
  }

  async getWorkflows(query?: WorkflowsQuery): Promise<PaginatedWorkflows> {
    this.state.record("getWorkflows", query);
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const workflows = this.state.workflows.slice((page - 1) * pageSize, page * pageSize);
    return { workflows, total: this.state.workflows.length, page, pageSize };
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    this.state.record("getWorkflow", id);
    return this.state.workflows.find((workflow) => workflow.id === id) ?? null;
  }

  async getWorkflowCatalog(): Promise<WorkflowCatalog> {
    this.state.record("getWorkflowCatalog");
    return this.state.workflowCatalog;
  }

  async createWorkflow(data: { definition: Omit<WorkflowDefinition, "id"> }): Promise<WorkflowMutationResult> {
    this.state.record("createWorkflow", data);
    const id = `workflow-${this.state.workflows.length + 1}`;
    const definition: WorkflowDefinition = { ...data.definition, id };
    this.state.workflows = [
      ...this.state.workflows,
      {
        id,
        name: definition.name,
        description: "",
        isEnabled: true,
        definition,
        stats: { runsToday: 0, successRate: 0 },
        createdAt: "2026-10-28T10:00:00Z",
        updatedAt: "2026-10-28T10:00:00Z",
      },
    ];
    return { id, definition, isEnabled: true };
  }

  async updateWorkflow(id: string, data: { definition: WorkflowDefinition }): Promise<WorkflowMutationResult | null> {
    this.state.record("updateWorkflow", id, data);
    const found = this.state.workflows.find((workflow) => workflow.id === id);
    if (found === undefined) {
      return null;
    }
    found.definition = data.definition;
    return { id, definition: data.definition, isEnabled: found.isEnabled };
  }

  async setWorkflowEnabled(id: string, isEnabled: boolean): Promise<{ id: string; isEnabled: boolean }> {
    this.state.record("setWorkflowEnabled", id, isEnabled);
    return { id, isEnabled };
  }

  /** Starts a run of a workflow the fake holds; any other name is refused as the engine refuses it. */
  async triggerWorkflowByName(
    workflowNameOrId: string,
    parameters?: Record<string, string>,
    userId?: string,
    triggerId?: string,
    triggeredBy?: string,
    options?: TriggerWorkflowOptions
  ): Promise<TriggerWorkflowResponse> {
    this.state.record("triggerWorkflowByName", workflowNameOrId, parameters, userId, triggerId, triggeredBy, options);
    const found = this.state.workflows.find((w) => w.id === workflowNameOrId || w.name === workflowNameOrId);
    if (found === undefined) {
      throw new Error(`Workflow ${JSON.stringify(workflowNameOrId)} not found`);
    }
    return {
      executionId: `exec-${found.id}`,
      triggerId: triggerId ?? "",
      status: "started",
      message: "",
      dryRun: options?.dryRun === true,
    };
  }

  async getWorkflowRun(executionId: string): Promise<WorkflowRunDetail | null> {
    this.state.record("getWorkflowRun", executionId);
    return this.state.workflowRuns[executionId] ?? null;
  }

  async listWorkflowRunSnapshots(query: WorkflowRunSnapshotsQuery): Promise<WorkflowRunSnapshot[]> {
    this.state.record("listWorkflowRunSnapshots", query);
    return this.state.runSnapshots
      .filter((run) => query.workflowId === undefined || run.workflowId === query.workflowId)
      .slice(0, query.limit);
  }

  async getWorkflowHealth(): Promise<WorkflowHealth[]> {
    this.state.record("getWorkflowHealth");
    if (this.state.workflowHealth instanceof Error) {
      throw this.state.workflowHealth;
    }
    return this.state.workflowHealth;
  }

  private mint(sceneId: string): OverlayToken {
    const n = this.state.overlayTokens.length + 1;
    const token: OverlayToken = {
      tokenId: `token-${n}`,
      token: `ovl_${n}`,
      sceneId,
      label: "",
      status: "active",
      createdAt: "2026-10-28T00:00:00Z",
      url: `http://overlay.test/overlay/ovl_${n}/`,
    };
    this.state.overlayTokens.push(token);
    return token;
  }

  async dispatchFieldOptionsRequest(
    reference: FieldOptionsReference,
    correlationKey: string
  ): Promise<{ dispatched: boolean }> {
    this.state.record("dispatchFieldOptionsRequest", reference, correlationKey);
    return { dispatched: true };
  }
}
