import type {
  AlertComposition,
  AlertListPage,
  AlertListQuery,
  AlertSnapshot,
  AvailableFunction,
  CommandSnapshot,
  CreateCommandInput,
  EngineModuleSummary,
  FieldOptionsReference,
  Leaderboard,
  LeaderboardQuery,
  MarketplaceAuthorQuery,
  MarketplaceBundleInstallResult,
  MarketplaceCatalogQuery,
  MarketplaceInstallRequest,
  MarketplaceInstallResult,
  MarketplaceListingInspection,
  ModuleFileContent,
  ModuleFileList,
  ModuleSetting,
  ModuleSettingsResponse,
  PaginatedStreamSessions,
  PaginatedWorkflows,
  ResourceInstanceDefinition,
  RunActionsInput,
  SceneSnapshot,
  StreamEventFrame,
  StreamEventSubscriber,
  StreamSession,
  StreamSessionsQuery,
  StreamSessionTotals,
  StreamStatus,
  TriggerWorkflowOptions,
  TriggerWorkflowResponse,
  TwitchAddBlockedTermParams,
  TwitchBanUserParams,
  TwitchChatPinParams,
  TwitchCreateStreamMarkerParams,
  TwitchGetBlockedTermsParams,
  TwitchGetChattersParams,
  TwitchGetGamesParams,
  TwitchGetUsersParams,
  TwitchHelixResult,
  TwitchLinkInfo,
  TwitchModifyChannelInformationParams,
  TwitchRemoveBlockedTermParams,
  TwitchSearchCategoriesParams,
  TwitchSendChatAnnouncementParams,
  TwitchSendChatMessageParams,
  TwitchSendShoutoutParams,
  TwitchUnbanUserParams,
  TwitchUpdateChatSettingsParams,
  UISetting,
  UISettingValue,
  UISettingWriteResult,
  UninstallModuleResponse,
  ViewerTotals,
  ViewerTotalsQuery,
  WidgetThemes,
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
import { formatMarketplaceCatalogError } from "@woofx3/api/marketplace-catalog";
import type {
  TwitchDeviceLoginStartResult,
  TwitchDeviceLoginState,
  TwitchDeviceLoginStateResult,
} from "@woofx3/api/twitch-device-login";
import type { WorkflowDefinition } from "@woofx3/api/workflow-definition";
import { FakeApi, type FakeEngine } from "@/lib/engine-session/testing/FakeEngine";

/** The engine methods the direct gateway's tests serve beyond every session's. */
type DirectFakeSurface = Pick<
  Woofx3EngineApi,
  | "listCommands"
  | "createCommand"
  | "getStreamStatus"
  | "listStreamSessions"
  | "getStreamSession"
  | "getStreamSessionTotals"
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
  | "listWidgetThemes"
  | "listUISettings"
  | "getUISetting"
  | "setUISetting"
  | "deleteUISetting"
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
  | "listAllResourceInstances"
  | "listResourceInstancesForModule"
  | "getResourceValues"
  | "createResourceInstance"
  | "runActions"
  | "executeCommand"
  | "listAvailableFunctions"
  | "marketplaceGetListing"
  | "marketplaceSearch"
  | "marketplaceCounts"
  | "marketplaceGetAuthor"
  | "inspectMarketplaceListing"
  | "installMarketplaceListing"
  | "installMarketplaceBundle"
  | "getModuleManifest"
  | "getModuleSettings"
  | "updateModuleSetting"
  | "listModuleFiles"
  | "getModuleFile"
  | "uninstallModule"
  | "getTwitchLink"
  | TwitchFakeMethod
  | "deleteTwitchToken"
  | "startTwitchDeviceLogin"
  | "getTwitchDeviceLogin"
  | "cancelTwitchDeviceLogin"
>;

/** The engine Twitch methods the fake answers, each with `FakeEngineState.twitchAnswer`. */
export type TwitchFakeMethod =
  | "twitchGetChannelInformation"
  | "twitchGetGames"
  | "twitchSearchCategories"
  | "twitchModifyChannelInformation"
  | "twitchCreateStreamMarker"
  | "twitchGetAdSchedule"
  | "twitchSnoozeNextAd"
  | "twitchGetUsers"
  | "twitchGetBlockedTerms"
  | "twitchAddBlockedTerm"
  | "twitchRemoveBlockedTerm"
  | "twitchBanUser"
  | "twitchUnbanUser"
  | "twitchGetChatSettings"
  | "twitchUpdateChatSettings"
  | "twitchSendChatMessage"
  | "twitchSendChatAnnouncement"
  | "twitchSendShoutout"
  | "twitchGetChatters"
  | "twitchGetChatPins"
  | "twitchUnpinChatMessage"
  | "twitchCreateClip";

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
  /** Newest first. */
  sessions: StreamSession[] = [];
  /** A session's totals by its id; a session with none answers null. */
  sessionTotals: Record<string, StreamSessionTotals> = {};
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
  /** UI settings by namespace, then key, tombstones (`deleted`) included. */
  uiSettings: Record<string, Record<string, UISetting>> = {};
  uiSettingRevision = 0;
  /**
   * Runs before a set or delete checks its expected revision, as another
   * writer landing first would: a test changes `uiSettings` here to make the
   * write conflict.
   */
  beforeUISettingWrite: ((namespace: string, key: string) => void) | null = null;
  /** Themes by widget canonical id; a widget not here is refused. */
  widgetThemes: Record<string, WidgetThemes["themes"]> = {};
  modules: EngineModuleSummary[] = [];
  workflows: Workflow[] = [];
  workflowCatalog: WorkflowCatalog = { triggers: [], actions: [], functions: [] };
  /** Recorded runs by execution id; an id not here answers null. */
  workflowRuns: Record<string, WorkflowRunDetail> = {};
  /** Every recorded run, newest first, as `listWorkflowRunSnapshots` lists them. */
  runSnapshots: WorkflowRunSnapshot[] = [];
  resourceInstances: ResourceInstanceDefinition[] = [];
  /** Resource values by canonical id; an instance not here holds nothing yet. */
  resourceValues: Record<string, unknown> = {};
  functions: AvailableFunction[] = [];
  /** The marketplace's answers to `/catalog/{id}` by listing id; an id not here is refused, as the marketplace answers 404. */
  listings: Record<string, unknown> = {};
  /** The marketplace's answer to `/catalog` for a query. */
  catalogSearch: (query: MarketplaceCatalogQuery) => unknown = () => ({ listings: [], total: 0 });
  /** The marketplace's answer to `/catalog/counts`; a status refuses it, as an older marketplace answers 404. */
  catalogCounts: unknown | { refusedWith: number } = { counts: {}, total: 0 };
  /** The marketplace's answers to `/authors/{slug}` by slug, given the page asked for; a slug not here is refused with 404. */
  authors: Record<string, (query: MarketplaceAuthorQuery | undefined) => unknown> = {};
  /** Listing inspections by id; an id not here is refused, as a paid listing is without a buyer token. */
  inspections: Record<string, MarketplaceListingInspection> = {};
  /** What `installMarketplaceListing` and `installMarketplaceBundle` answer. */
  listingInstall: MarketplaceInstallResult = { status: "installed", moduleKey: "listing:1.0.0:abc1234" };
  bundleInstall: MarketplaceBundleInstallResult = {
    status: "installed",
    listingId: "bundle",
    engineId: "scene-1",
    kind: "scene",
  };
  /** Stored settings by manifest id; the manifests come from `modules`. */
  moduleSettings: Record<string, ModuleSetting[]> = {};
  moduleFiles: Record<string, ModuleFileList> = {};
  /** What `startTwitchDeviceLogin` answers. */
  deviceLoginStart: TwitchDeviceLoginStartResult = {
    ok: true,
    login: {
      loginId: "login-1",
      userCode: "WOOF-1234",
      verificationUri: "https://www.twitch.tv/activate",
      expiresAt: "2026-10-29T12:00:00.000Z",
    },
  };
  /** Device logins by id; an id not here answers `not_found`. */
  deviceLogins: Record<string, TwitchDeviceLoginState> = {};
  /** What `getWorkflowHealth` answers, or the error it throws. */
  workflowHealth: WorkflowHealth[] | Error = [];
  twitchLink: TwitchLinkInfo = { linked: false, revision: 1 };
  /** What `executeCommand` answers; the engine refuses a command by answering `success: false`. */
  commandAnswer: { success: boolean; message: string } = { success: true, message: "" };
  /** What each Twitch method answers, given its arguments; no answer configured fails the call. */
  twitchAnswer: (method: TwitchFakeMethod, params: unknown) => TwitchHelixResult = (method) => ({
    ok: false,
    code: "failed",
    error: `no answer configured for ${method}`,
  });
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

/** The error message an engine throws for a marketplace that refused a catalog read with `status`. */
function marketplaceRefusal(status: number): string {
  return formatMarketplaceCatalogError({ kind: "http", status, code: "refused", message: `Refused with ${status}` });
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

  async listStreamSessions(query?: StreamSessionsQuery): Promise<PaginatedStreamSessions> {
    this.state.record("listStreamSessions", query);
    const limit = query?.limit ?? 50;
    return { sessions: this.state.sessions.slice(0, limit), total: this.state.sessions.length, limit, offset: 0 };
  }

  async getStreamSession(id: string): Promise<StreamSession | null> {
    this.state.record("getStreamSession", id);
    return this.state.sessions.find((session) => session.id === id) ?? null;
  }

  async getStreamSessionTotals(sessionId: string): Promise<StreamSessionTotals | null> {
    this.state.record("getStreamSessionTotals", sessionId);
    return this.state.sessionTotals[sessionId] ?? null;
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

  async listUISettings(namespace: string): Promise<UISetting[]> {
    this.state.record("listUISettings", namespace);
    return Object.values(this.state.uiSettings[namespace] ?? {}).filter((setting) => !setting.deleted);
  }

  async getUISetting(namespace: string, key: string): Promise<UISetting | null> {
    this.state.record("getUISetting", namespace, key);
    const setting = this.state.uiSettings[namespace]?.[key];
    return setting && !setting.deleted ? setting : null;
  }

  async setUISetting(
    namespace: string,
    key: string,
    value: UISettingValue,
    expectedRevision?: number
  ): Promise<UISettingWriteResult> {
    this.state.record(
      "setUISetting",
      namespace,
      key,
      value,
      ...(expectedRevision === undefined ? [] : [expectedRevision])
    );
    return this.writeUISetting(namespace, key, value, false, expectedRevision);
  }

  async deleteUISetting(namespace: string, key: string, expectedRevision?: number): Promise<UISettingWriteResult> {
    this.state.record("deleteUISetting", namespace, key, ...(expectedRevision === undefined ? [] : [expectedRevision]));
    return this.writeUISetting(namespace, key, null, true, expectedRevision);
  }

  /** The engine's check and write: 0 expects no live value, any other revision the stored one. */
  private writeUISetting(
    namespace: string,
    key: string,
    value: UISettingValue,
    deleted: boolean,
    expectedRevision: number | undefined
  ): UISettingWriteResult {
    this.state.beforeUISettingWrite?.(namespace, key);
    const stored = this.state.uiSettings[namespace]?.[key] ?? null;
    if (expectedRevision !== undefined) {
      const matches =
        expectedRevision === 0 ? stored === null || stored.deleted : stored?.revision === expectedRevision;
      if (!matches) {
        return { ok: false, reason: "conflict", current: stored };
      }
    }
    this.state.uiSettingRevision += 1;
    const setting: UISetting = {
      namespace,
      key,
      value,
      revision: this.state.uiSettingRevision,
      updatedAt: "2026-10-30T10:00:00Z",
      deleted,
    };
    this.state.uiSettings[namespace] = { ...(this.state.uiSettings[namespace] ?? {}), [key]: setting };
    return { ok: true, setting };
  }

  async listWidgetThemes(widgetCanonicalId: string): Promise<WidgetThemes> {
    this.state.record("listWidgetThemes", widgetCanonicalId);
    const themes = this.state.widgetThemes[widgetCanonicalId];
    if (themes === undefined) {
      throw new Error(`no widget ${widgetCanonicalId}`);
    }
    return { widget: widgetCanonicalId, contractVersion: 1, themes };
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

  async listAllResourceInstances(): Promise<ResourceInstanceDefinition[]> {
    this.state.record("listAllResourceInstances");
    return this.state.resourceInstances;
  }

  async listResourceInstancesForModule(moduleKey: string, moduleName?: string): Promise<ResourceInstanceDefinition[]> {
    this.state.record("listResourceInstancesForModule", moduleKey, moduleName);
    return this.state.resourceInstances.filter((instance) => instance.moduleKey === moduleKey);
  }

  async getResourceValues(canonicalIds: string[]): Promise<Record<string, unknown>> {
    this.state.record("getResourceValues", canonicalIds);
    return Object.fromEntries(canonicalIds.map((id) => [id, this.state.resourceValues[id] ?? null]));
  }

  async createResourceInstance(
    moduleName: string,
    kind: string,
    instanceId: string,
    displayName: string,
    settings?: Record<string, unknown>
  ): Promise<ResourceInstanceDefinition> {
    this.state.record("createResourceInstance", moduleName, kind, instanceId, displayName, settings);
    const created: ResourceInstanceDefinition = {
      id: `row-${this.state.resourceInstances.length + 1}`,
      moduleId: "uuid",
      moduleName,
      kind,
      instanceId,
      displayName,
      canonicalId: `${moduleName}:${kind}:${instanceId}`,
      moduleKey: `${moduleName}:1.0.0:abc`,
      settings: settings ?? {},
    };
    this.state.resourceInstances = [...this.state.resourceInstances, created];
    return created;
  }

  async runActions(input: RunActionsInput): Promise<{ requested: true; triggerId: string }> {
    this.state.record("runActions", input);
    return { requested: true, triggerId: "trigger-1" };
  }

  async executeCommand(
    commandName: string,
    username: string,
    text?: string
  ): Promise<{ success: boolean; message: string }> {
    this.state.record("executeCommand", commandName, username, text);
    return this.state.commandAnswer;
  }

  async listAvailableFunctions(): Promise<AvailableFunction[]> {
    this.state.record("listAvailableFunctions");
    return this.state.functions;
  }

  async marketplaceGetListing(listingId: string, buyerToken?: string): Promise<unknown> {
    this.state.record("marketplaceGetListing", listingId, buyerToken);
    const listing = this.state.listings[listingId];
    if (listing === undefined) {
      throw new Error(marketplaceRefusal(404));
    }
    return listing;
  }

  async marketplaceSearch(query: MarketplaceCatalogQuery, buyerToken?: string): Promise<unknown> {
    this.state.record("marketplaceSearch", query, buyerToken);
    return this.state.catalogSearch(query);
  }

  async marketplaceCounts(buyerToken?: string): Promise<unknown> {
    this.state.record("marketplaceCounts", buyerToken);
    const counts = this.state.catalogCounts;
    if (counts && typeof counts === "object" && "refusedWith" in counts) {
      throw new Error(marketplaceRefusal(counts.refusedWith as number));
    }
    return counts;
  }

  async marketplaceGetAuthor(slug: string, query?: MarketplaceAuthorQuery, buyerToken?: string): Promise<unknown> {
    this.state.record("marketplaceGetAuthor", slug, query, buyerToken);
    const author = this.state.authors[slug];
    if (author === undefined) {
      throw new Error(marketplaceRefusal(404));
    }
    return author(query);
  }

  async inspectMarketplaceListing(listingId: string, buyerToken?: string): Promise<MarketplaceListingInspection> {
    this.state.record("inspectMarketplaceListing", listingId, buyerToken);
    const inspection = this.state.inspections[listingId];
    if (inspection === undefined) {
      throw new Error("Payment required");
    }
    return inspection;
  }

  async installMarketplaceListing(
    listingId: string,
    request: MarketplaceInstallRequest
  ): Promise<MarketplaceInstallResult> {
    this.state.record("installMarketplaceListing", listingId, request);
    return this.state.listingInstall;
  }

  async installMarketplaceBundle(listingId: string, buyerToken?: string): Promise<MarketplaceBundleInstallResult> {
    this.state.record("installMarketplaceBundle", listingId, buyerToken);
    return this.state.bundleInstall;
  }

  private moduleNamed(moduleId: string): EngineModuleSummary | undefined {
    return this.state.modules.find((module) => module.moduleId === moduleId);
  }

  async getModuleManifest(moduleId: string): Promise<Record<string, unknown> | null> {
    this.state.record("getModuleManifest", moduleId);
    return this.moduleNamed(moduleId)?.manifest ?? null;
  }

  async getModuleSettings(moduleId: string): Promise<ModuleSettingsResponse> {
    this.state.record("getModuleSettings", moduleId);
    return { settings: this.state.moduleSettings[moduleId] ?? [] };
  }

  async updateModuleSetting(moduleId: string, key: string, value: string): Promise<ModuleSetting> {
    this.state.record("updateModuleSetting", moduleId, key, value);
    const setting = { id: `${moduleId}-${key}`, moduleId, key, value, valueType: "string", isSet: true };
    const others = (this.state.moduleSettings[moduleId] ?? []).filter((stored) => stored.key !== key);
    this.state.moduleSettings[moduleId] = [...others, setting];
    return setting;
  }

  async listModuleFiles(moduleId: string): Promise<ModuleFileList> {
    this.state.record("listModuleFiles", moduleId);
    return this.state.moduleFiles[moduleId] ?? { available: false, files: [] };
  }

  async getModuleFile(moduleId: string, path: string): Promise<ModuleFileContent> {
    this.state.record("getModuleFile", moduleId, path);
    return { path, size: 1, kind: "text", content: `${moduleId}/${path}` };
  }

  async uninstallModule(moduleKey: string): Promise<UninstallModuleResponse> {
    this.state.record("uninstallModule", moduleKey);
    return { requested: true };
  }

  async deleteTwitchToken(): Promise<{ ok: true }> {
    this.state.record("deleteTwitchToken");
    this.state.twitchLink = { linked: false, revision: this.state.twitchLink.revision + 1 };
    return { ok: true };
  }

  async startTwitchDeviceLogin(scopes?: string[]): Promise<TwitchDeviceLoginStartResult> {
    this.state.record("startTwitchDeviceLogin", scopes);
    const start = this.state.deviceLoginStart;
    if (start.ok) {
      this.state.deviceLogins[start.login.loginId] = {
        loginId: start.login.loginId,
        status: "pending",
        expiresAt: start.login.expiresAt,
      };
    }
    return start;
  }

  async getTwitchDeviceLogin(loginId: string): Promise<TwitchDeviceLoginStateResult> {
    this.state.record("getTwitchDeviceLogin", loginId);
    const state = this.state.deviceLogins[loginId];
    return state === undefined ? { ok: false, code: "not_found", error: "no such login" } : { ok: true, state };
  }

  async cancelTwitchDeviceLogin(loginId: string): Promise<{ cancelled: boolean }> {
    this.state.record("cancelTwitchDeviceLogin", loginId);
    const cancelled = this.state.deviceLogins[loginId]?.status === "pending";
    delete this.state.deviceLogins[loginId];
    return { cancelled };
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

  async getTwitchLink(): Promise<TwitchLinkInfo> {
    this.state.record("getTwitchLink");
    return this.state.twitchLink;
  }

  private twitch(method: TwitchFakeMethod, params?: unknown): TwitchHelixResult {
    this.state.record(method, ...(params === undefined ? [] : [params]));
    return this.state.twitchAnswer(method, params);
  }

  async twitchGetChannelInformation(): Promise<TwitchHelixResult> {
    return this.twitch("twitchGetChannelInformation");
  }

  async twitchGetGames(params: TwitchGetGamesParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchGetGames", params);
  }

  async twitchSearchCategories(params: TwitchSearchCategoriesParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchSearchCategories", params);
  }

  async twitchModifyChannelInformation(params: TwitchModifyChannelInformationParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchModifyChannelInformation", params);
  }

  async twitchCreateStreamMarker(params: TwitchCreateStreamMarkerParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchCreateStreamMarker", params);
  }

  async twitchGetAdSchedule(): Promise<TwitchHelixResult> {
    return this.twitch("twitchGetAdSchedule");
  }

  async twitchSnoozeNextAd(): Promise<TwitchHelixResult> {
    return this.twitch("twitchSnoozeNextAd");
  }

  async twitchGetUsers(params: TwitchGetUsersParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchGetUsers", params);
  }

  async twitchGetBlockedTerms(params: TwitchGetBlockedTermsParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchGetBlockedTerms", params);
  }

  async twitchAddBlockedTerm(params: TwitchAddBlockedTermParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchAddBlockedTerm", params);
  }

  async twitchRemoveBlockedTerm(params: TwitchRemoveBlockedTermParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchRemoveBlockedTerm", params);
  }

  async twitchBanUser(params: TwitchBanUserParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchBanUser", params);
  }

  async twitchUnbanUser(params: TwitchUnbanUserParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchUnbanUser", params);
  }

  async twitchGetChatSettings(): Promise<TwitchHelixResult> {
    return this.twitch("twitchGetChatSettings");
  }

  async twitchUpdateChatSettings(params: TwitchUpdateChatSettingsParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchUpdateChatSettings", params);
  }

  async twitchSendChatMessage(params: TwitchSendChatMessageParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchSendChatMessage", params);
  }

  async twitchSendChatAnnouncement(params: TwitchSendChatAnnouncementParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchSendChatAnnouncement", params);
  }

  async twitchSendShoutout(params: TwitchSendShoutoutParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchSendShoutout", params);
  }

  async twitchGetChatters(params: TwitchGetChattersParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchGetChatters", params);
  }

  async twitchGetChatPins(): Promise<TwitchHelixResult> {
    return this.twitch("twitchGetChatPins");
  }

  async twitchUnpinChatMessage(params: TwitchChatPinParams): Promise<TwitchHelixResult> {
    return this.twitch("twitchUnpinChatMessage", params);
  }

  async twitchCreateClip(): Promise<TwitchHelixResult> {
    return this.twitch("twitchCreateClip");
  }
}
