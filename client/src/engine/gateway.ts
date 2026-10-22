import type {
  AdSchedule,
  AdSnoozeResult,
  AlertClearResult,
  AlertComposition,
  AlertOverview,
  AlertReplayResult,
  AlertSkipResult,
  AlertTargetUsage,
  Announcement,
  BlockedTerm,
  BlockedTermList,
  ChatCommand,
  ChatCommandChanges,
  ChatCommandGroup,
  ChatCommandGroupChanges,
  ChatSettings,
  ChatSettingsPatch,
  Chatter,
  CompositionPreviewUrl,
  ConfigExportRequest,
  ConfigImportPlan,
  ConfigImportRequest,
  ConfigImportResult,
  Correlated,
  CorrelatedRequestKind,
  CorrelatedRequests,
  CreatedClip,
  CreatedModuleResourceInstance,
  CurrentPin,
  DeclaredResourceKind,
  EngineAlert,
  EngineCapabilityReport,
  EngineConnectionTest,
  EngineInfo,
  EngineSyncRequest,
  EngineSyncState,
  EngineTestEvent,
  EngineWorkflowOption,
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  EventWatch,
  GoLiveCheckId,
  GoLiveChecklistState,
  GoLiveCompletion,
  GoLiveFinish,
  GoLiveOverlayFacts,
  GoLiveStreamInfoFacts,
  GoLiveTwitchFacts,
  HostedStorageUsage,
  InstanceLiveState,
  KnownBoxArt,
  Live,
  MacroId,
  MacroRunResult,
  MacroVariableValue,
  MarketplaceBundleInstall,
  ModeratedUser,
  ModerationAccess,
  ModuleArchiveInstall,
  ModuleDetail,
  ModuleFileContent,
  ModuleFileList,
  ModuleId,
  ModuleOAuthConnect,
  ModuleOAuthFinish,
  ModuleResourceInstance,
  ModuleResourceInstanceChanges,
  ModuleSettingValue,
  ModuleStorageUsage,
  NewChatCommand,
  NewChatCommandGroup,
  NewLibraryAlert,
  NewModuleResourceInstance,
  NewScene,
  NewStreamInfoPreset,
  NotRunningWorkflow,
  ObsStatus,
  OpenSessionRefresh,
  Paginated,
  PinHistoryEntry,
  PinHistoryEntryId,
  PinnedMessage,
  PublishedTestEvent,
  ReadOptions,
  RecapTimelineEvents,
  RecordedWorkflowRun,
  RepinnedMessage,
  Resource,
  ResourceChanges,
  ResourcePage,
  ResourceQuery,
  ResourceValues,
  SceneChanges,
  SceneEditorGrant,
  SceneId,
  SceneRecord,
  SceneRepairResult,
  SceneWidgetCatalogRow,
  SetupImportAnalysis,
  SetupImportId,
  SetupImportReport,
  ShoutoutEntry,
  ShoutoutEntryId,
  StarterPackInstall,
  StarterPackInstallOutcome,
  StarterPackItemState,
  StorageConfig,
  StreamCategory,
  StreamEventFrame,
  StreamInfo,
  StreamInfoChanges,
  StreamInfoPreset,
  StreamInfoPresetId,
  StreamInfoUpdate,
  StreamMarker,
  StreamRecapEngineDetail,
  Supporter,
  SupporterLeaderboardQuery,
  SupporterStream,
  TransientEvent,
  TwitchChannel,
  TwitchLink,
  TwitchLinkFlow,
  UploadGrant,
  UploadRequest,
  ViewerFact,
  ViewerSupportTotals,
  WebhookEventId,
  WebhookEventSummary,
  WidgetThemes,
  Workflow,
  WorkflowCancelResult,
  WorkflowCatalog,
  WorkflowHealthResyncResult,
  WorkflowHealthResyncTrigger,
  WorkflowReplay,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowTrigger,
  WorkflowTriggerResult,
} from "@/engine/types";

/**
 * Everything the UI asks of the instance's engine, one namespace per domain
 * (namespaces.ts lists the Convex modules behind each).
 *
 * Members are React hooks. A gateway is chosen once when the app boots and
 * never swapped, so a component calls the same hooks in the same order on
 * every render. A member named `use...Request` returns a function that
 * performs one call; any other member is a read.
 *
 * No member takes an instance: a gateway acts on the instance its engine
 * scope (`useEngineScope()`) holds. While the scope has none, reads stay
 * loading and requests reject. A request function keeps its identity until
 * the scope's instance changes, so it is safe in effect dependencies and an
 * effect using it runs again for a newly selected instance.
 */
export interface EngineGateway {
  readonly status: StatusGateway;
  readonly resources: ResourcesGateway;
  readonly eventLog: EventLogGateway;
  readonly alertQueue: AlertQueueGateway;
  readonly alertLibrary: AlertLibraryGateway;
  readonly commands: CommandsGateway;
  readonly moduleResources: ModuleResourcesGateway;
  readonly modules: ModulesGateway;
  readonly scenes: ScenesGateway;
  readonly workflows: WorkflowsGateway;
  readonly requests: RequestsGateway;
  readonly macros: MacrosGateway;
  readonly streamOps: StreamOpsGateway;
  readonly config: ConfigGateway;
  readonly session: SessionGateway;
  readonly twitchLink: TwitchLinkGateway;
  readonly overlays: OverlaysGateway;
  readonly moduleOAuth: ModuleOAuthGateway;
  readonly setupImports: SetupImportsGateway;
  readonly starterPacks: StarterPacksGateway;
  readonly adBreaks: AdBreaksGateway;
  readonly moderation: ModerationGateway;
  readonly pins: PinsGateway;
  readonly shoutouts: ShoutoutsGateway;
  readonly twitchChat: TwitchChatGateway;
  readonly clips: ClipsGateway;
  readonly streamInfo: StreamInfoGateway;
  readonly goLive: GoLiveGateway;
}

/** Engine reachability, version, features and stream state. */
export interface StatusGateway {
  /** Rejects when the caller is not a member, the instance has no engine, or the engine cannot be asked. */
  useCapabilitiesRequest(): () => Promise<EngineCapabilityReport>;
  /** Null when the engine is not registered or did not answer. */
  useEngineInfoRequest(): () => Promise<EngineInfo | null>;
  useSetOverlayPublicUrlRequest(): (value: string) => Promise<{ success: boolean }>;
  /**
   * Pings an engine by URL, before or apart from registration, so it names
   * its target and needs no scope. Resolves with the failure rather than
   * rejecting.
   */
  useConnectionTestRequest(): (url: string) => Promise<EngineConnectionTest>;
  useObsStatusRequest(): () => Promise<ObsStatus>;
  /**
   * The instance's live state, read with the scope's optimistic id so it
   * shows before the membership list loads. While that id is unconfirmed an
   * error reads as loading, because a cached id can be malformed for this
   * deployment and is replaced one round trip later.
   */
  useLiveState(): Live<InstanceLiveState | null>;
  /** Asks the engine for the stream state now rather than waiting for its callbacks. */
  useLiveStatePollRequest(): () => Promise<{ ok: boolean }>;
  /** Null when the caller cannot see the instance. */
  useSyncState(options?: ReadOptions): Live<EngineSyncState | null>;
  useSyncRequest(): () => Promise<EngineSyncRequest>;
}

/** The engine's uploaded files and folders. */
export interface ResourcesGateway {
  useListRequest(): (query: ResourceQuery) => Promise<ResourcePage>;
  /** Null when the instance is not on hosted storage. */
  useHostedStorageUsageRequest(): () => Promise<HostedStorageUsage | null>;
  /** Reserves a pending resource and returns where to PUT its bytes. Rejects when a plan limit refuses it. */
  useUploadGrantRequest(): (file: UploadRequest) => Promise<UploadGrant>;
  /** Marks a granted upload's bytes as landed. */
  useCompleteUploadRequest(): (resourceId: string) => Promise<Resource>;
  /** Asks for a derived file such as a thumbnail; resolves once the request is accepted, not when it is done. */
  useProcessingRequest(): (resourceId: string, utility: string) => Promise<{ accepted: boolean }>;
  useCreateFolderRequest(): (name: string, parentId: string | null) => Promise<Resource>;
  /** Renames (`name`) or moves (`parentId`) a resource. */
  useUpdateRequest(): (resourceId: string, changes: ResourceChanges) => Promise<Resource>;
  useRemoveRequest(): (resourceId: string) => Promise<{ deleted: boolean }>;
}

/**
 * Events the engine received: the callbacks Convex recorded (the webhook log,
 * kept for debugging and retriggering), and the engine's own event log with
 * its live push and type selection.
 */
export interface EventLogGateway {
  /** Newest first, optionally of one type. */
  useWebhookEvents(eventType: string | null, initialNumItems: number): Paginated<WebhookEventSummary>;
  /** The raw payload JSON; null when the entry is gone or not the caller's. */
  useWebhookPayload(logId: WebhookEventId): Live<string | null>;
  /** Fires a logged event's type and payload at the engine again. */
  useRetriggerRequest(): (logId: WebhookEventId) => Promise<{ success: boolean; message: string }>;
  /**
   * Subscribes to pushed events of `types` (null: every type the engine
   * pushes); returns the unsubscribe. Throws while the scope has no instance.
   */
  useStreamEventsSubscription(): (
    types: readonly string[] | null,
    onFrame: (frame: StreamEventFrame) => void
  ) => () => void;
  /** A page of the engine's event log. Needs `events.log`. */
  useEventsRequest(): (query?: EventLogQuery) => Promise<EventLogPage>;
  /** Which event types the engine logs and pushes, and which it offers. Needs `events.log`. */
  useSettingsRequest(): () => Promise<EventLogSettings>;
  /** Replaces the engine's selection and resolves with the settings it results in. */
  useSetSelectionRequest(): (selection: EventLogSelection) => Promise<EventLogSettings>;
}

/** The alerts the engine dispatched, as its callbacks report them, and its overlay queue. */
export interface AlertQueueGateway {
  /** Newest first. Empty when the caller cannot see the instance. */
  useAlerts(limit: number): Live<EngineAlert[]>;
  /**
   * Totals by outcome and hourly buckets for the window ending with the hour
   * starting at `hourStart` (epoch ms on the hour). Null when the caller cannot
   * see the instance.
   */
  useOverview(hourStart: number): Live<AlertOverview | null>;
  /** Plays a recorded alert again. Resolves with the engine's answer, including a refusal. */
  useReplayRequest(): (engineAlertId: string) => Promise<AlertReplayResult>;
  /** Ends the alert playing on every open overlay. */
  useSkipCurrentRequest(): () => Promise<AlertSkipResult>;
  /** Drops every alert still waiting; the one playing keeps playing. */
  useClearQueueRequest(): () => Promise<AlertClearResult>;
}

/**
 * The engine's library of reusable alerts, read from the cache its webhooks
 * keep in Convex, and the page that previews a composition.
 */
export interface AlertLibraryGateway {
  /** By name. Empty when the caller cannot see the instance. */
  useAlerts(options?: ReadOptions): Live<AlertComposition[]>;
  /** Null until its webhook arrives, once it is deleted, or when the caller cannot see the instance. */
  useAlert(engineCompositionId: string): Live<AlertComposition | null>;
  /** Reads the engine's whole library into the cache, for alerts no webhook brought. */
  useRefreshRequest(): () => Promise<{ count: number }>;
  /** Rejects when the engine keeps no alert library or the name is blank. */
  useCreateRequest(): (alert: NewLibraryAlert) => Promise<{ engineCompositionId: string }>;
  useRemoveRequest(): (engineCompositionId: string) => Promise<{ success: boolean }>;
  /** A short-lived URL of the engine's composition preview page; null when the engine has none. */
  usePreviewUrlRequest(): () => Promise<CompositionPreviewUrl | null>;
}

/**
 * Chat commands and the user groups that may run them. Reads come from the
 * mirror the engine's webhooks keep in Convex; writes go to the engine, and
 * their result reaches the mirror the same way.
 */
export interface CommandsGateway {
  /** Empty when the caller cannot see the instance. */
  useCommands(): Live<ChatCommand[]>;
  /** Empty when the caller cannot see the instance. */
  useGroups(): Live<ChatCommandGroup[]>;
  /** One group's usernames. */
  useGroupMembers(engineGroupId: string): Live<string[]>;
  useCreateCommandRequest(): (command: NewChatCommand) => Promise<{ engineCommandId: string }>;
  useUpdateCommandRequest(): (command: ChatCommandChanges) => Promise<{ engineCommandId: string }>;
  useDeleteCommandRequest(): (engineCommandId: string) => Promise<{ deleted: boolean }>;
  useCreateGroupRequest(): (group: NewChatCommandGroup) => Promise<{ engineGroupId: string }>;
  useUpdateGroupRequest(): (group: ChatCommandGroupChanges) => Promise<{ engineGroupId: string }>;
  useDeleteGroupRequest(): (engineGroupId: string) => Promise<{ deleted: boolean }>;
  useAddGroupMemberRequest(): (engineGroupId: string, username: string) => Promise<{ ok: true }>;
  useRemoveGroupMemberRequest(): (engineGroupId: string, username: string) => Promise<{ ok: true }>;
}

/**
 * Runtime instances of the resource kinds installed modules declare (counters,
 * timers, queues), their values, and the kinds themselves. Reads come from the
 * mirror the engine's webhooks keep in Convex; writes go to the engine.
 */
export interface ModuleResourcesGateway {
  /** Every resource instance. Empty when the caller cannot see the instance. */
  useInstances(): Live<ModuleResourceInstance[]>;
  /** One installed module's instances. Skipped (always loading) for a null module id. */
  useModuleInstances(moduleId: ModuleId | null): Live<ModuleResourceInstance[]>;
  /**
   * The instances of one kind: `module:kind`, or a bare kind. Skipped (always
   * loading) for a null kind.
   */
  useKindInstances(kind: string | null): Live<ModuleResourceInstance[]>;
  /**
   * The instances of several kinds in one read, each `module:kind` or bare.
   * Skipped (always loading) for no kinds.
   */
  useKindsInstances(kinds: readonly string[]): Live<ModuleResourceInstance[]>;
  /** Every mirrored value, keyed by canonical id. */
  useValues(): Live<ResourceValues>;
  /**
   * The module providing a kind, and its declaration; null when no installed
   * module declares it. Skipped (always loading) for a null kind.
   */
  useKind(kind: string | null): Live<DeclaredResourceKind | null>;
  /** Every kind the installed modules declare. */
  useKinds(): Live<DeclaredResourceKind[]>;
  useCreateRequest(): (resource: NewModuleResourceInstance) => Promise<CreatedModuleResourceInstance>;
  useUpdateRequest(): (changes: ModuleResourceInstanceChanges) => Promise<null>;
  useRemoveRequest(): (canonicalId: string) => Promise<null>;
  /** Reads one module's instances from the engine into the mirror, for any no webhook brought. */
  useSyncModuleRequest(): (moduleId: ModuleId) => Promise<{ itemsProcessed: number }>;
  /** Reads the current value of every instance of a kind from the engine into the mirror. */
  useRefreshValuesRequest(): (kind: string) => Promise<null>;
  /**
   * Runs action steps on the engine now. `actions` carry their `$` keys escaped
   * (lib/dollar-keys); the result arrives through the values they change.
   */
  useRunActionsRequest(): (label: string, actions: unknown[]) => Promise<null>;
}

/**
 * Installed modules as the engine runs them: their detail, settings and files,
 * and uninstalling them. `moduleId` is what the module detail was asked for
 * with (an installed module's key or a marketplace id) unless typed `ModuleId`.
 */
export interface ModulesGateway {
  /** The module's manifest-derived detail, merged with its marketplace listing when it has one. */
  useDetailRequest(): (moduleId: string) => Promise<ModuleDetail>;
  /** The declared settings' current values; a secret's value never comes back, only whether one is set. */
  useSettingsRequest(): (moduleId: string) => Promise<ModuleSettingValue[]>;
  /** Rejects for a key the module does not declare as a setting. */
  useUpdateSettingRequest(): (moduleId: string, key: string, value: string) => Promise<ModuleSettingValue>;
  useFilesRequest(): (moduleId: string) => Promise<ModuleFileList>;
  useFileRequest(): (moduleId: string, path: string) => Promise<ModuleFileContent>;
  /**
   * Asks the engine to uninstall; resolves with the key its outcome is
   * reported under (`transientEvents`), not when the module is gone.
   */
  useUninstallRequest(): (moduleId: ModuleId) => Promise<{ moduleKey: string }>;
  /** Asks the engine whether an uninstall whose outcome never arrived took effect, and settles the mirror. */
  useReconcileUninstallRequest(): (moduleId: ModuleId, correlationKey: string) => Promise<{ stillInstalled: boolean }>;
  /** The engine's workflows, by id and name. */
  useWorkflowsRequest(): () => Promise<EngineWorkflowOption[]>;
  /**
   * Installs or updates a marketplace module; resolves with the key its
   * progress and outcome are reported under (`transientEvents`), not when it
   * is installed. Rejects when the archive declares a permission or local
   * endpoint (by id) outside the approved lists.
   */
  useMarketplaceInstallRequest(): (
    marketplaceModuleId: string,
    approvedPermissions: string[],
    approvedLocalEndpoints: string[]
  ) => Promise<{ moduleKey: string }>;
  /**
   * Installs a marketplace bundle (a scene or an alert) onto the engine and
   * resolves with what it made. Rejects for a listing the instance may not install.
   */
  useBundleInstallRequest(): (listingId: string) => Promise<MarketplaceBundleInstall>;
  /**
   * Installs or upgrades a module from an archive built in the browser;
   * resolves once the engine has been handed it, and the outcome is reported
   * under `moduleKey` (`transientEvents`).
   */
  useArchiveInstallRequest(): (install: ModuleArchiveInstall) => Promise<{ moduleKey: string }>;
  /** What every module keeps in module storage against the plan's limit; null when no limit applies or the engine cannot say. */
  useStorageUsageRequest(): () => Promise<ModuleStorageUsage | null>;
}

/**
 * Overlay scenes and the widgets they place. Reads come from the cache the
 * engine's webhooks keep in Convex; writes go to the engine, and their result
 * reaches the cache the same way.
 */
export interface ScenesGateway {
  /** Every scene. Empty when the caller cannot see the instance. */
  useScenes(options?: ReadOptions): Live<SceneRecord[]>;
  /** One scene by the engine's id; null until its webhook arrives, or when the caller cannot see the instance. */
  useScene(engineSceneId: string): Live<SceneRecord | null>;
  /**
   * The widgets the instance can place, with the name of the module providing
   * each. Empty when the caller cannot see the instance.
   */
  useWidgetCatalog(options?: ReadOptions): Live<SceneWidgetCatalogRow[]>;
  /**
   * Every name an alert widget on the instance's scenes answers to, the
   * default first. Empty when the caller cannot see the instance.
   */
  useAlertWidgetNames(options?: ReadOptions): Live<string[]>;
  /**
   * What one scene's editor needs to warn that an edit leaves Alert steps
   * with no alert widget to play on: every Alert step's target, and the names
   * the alert widgets of the instance's other scenes answer to. Null when the
   * caller cannot see the instance.
   */
  useAlertTargetUsage(engineSceneId: string): Live<AlertTargetUsage | null>;
  useCreateRequest(): (scene: NewScene) => Promise<{ engineSceneId: string }>;
  useUpdateRequest(): (engineSceneId: string, changes: SceneChanges) => Promise<{ success: boolean }>;
  useRemoveRequest(): (engineSceneId: string) => Promise<{ success: boolean }>;
  /** The installed themes made for one widget. */
  useWidgetThemesRequest(): (widgetCanonicalId: string) => Promise<WidgetThemes>;
  /**
   * A short-lived token for sceneManager's editor socket for one scene, and
   * the socket's path. Null when the engine does not know the scene or cannot
   * reach sceneManager. Needs `scenes.editorSync`.
   */
  useEditorSessionRequest(): (engineSceneId: string) => Promise<SceneEditorGrant | null>;
  /**
   * Repair a scene or alert whose stored data the engine cannot read: the
   * engine keeps a copy of what it cannot read, then writes back the readable
   * rest. Needs `scenes.repair`.
   */
  useRepairRequest(): (engineSceneId: string) => Promise<SceneRepairResult>;
}

/**
 * Workflows and the catalog the builder composes them from. Reads come from
 * the mirror the engine's webhooks keep in Convex.
 */
export interface WorkflowsGateway {
  /** Every workflow. Empty when the caller cannot see the instance. */
  useWorkflows(): Live<Workflow[]>;
  /** Whether the instance has any workflow; null while the caller's membership cannot be confirmed. */
  useHasAny(): Live<boolean | null>;
  /**
   * One workflow by the engine's id; null until its webhook arrives, or when
   * the caller cannot see the instance. Skipped (always loading) for a null
   * engine id.
   */
  useWorkflow(engineWorkflowId: string | null): Live<Workflow | null>;
  /** Null when the caller cannot see the instance. */
  useCatalog(): Live<WorkflowCatalog | null>;
  /**
   * Creates a workflow from a definition with its `$` keys escaped
   * (lib/dollar-keys), and resolves once its webhook echo has landed, with
   * the id the engine gave it.
   */
  useCreateRequest(): (definition: unknown) => Promise<{ engineWorkflowId: string }>;
  /** Replaces a workflow's definition (`$` keys escaped); resolves once its webhook echo has landed. */
  useUpdateRequest(): (engineWorkflowId: string, definition: unknown) => Promise<{ engineWorkflowId: string }>;
  /** Resolves once the delete's webhook echo has landed. */
  useRemoveRequest(): (engineWorkflowId: string) => Promise<{ deleted: true }>;
  /** Resolves once the change's webhook echo has landed. */
  useSetEnabledRequest(): (engineWorkflowId: string, isEnabled: boolean) => Promise<{ isEnabled: boolean }>;
  /** Starts a manual run and resolves at once with its key; the run's progress arrives in transient events. */
  useTriggerRequest(): (run: WorkflowTrigger) => Promise<WorkflowTriggerResult>;
  /** The values `${viewer.*}` resolves on the engine. Needs `workflow.viewerFacts`. */
  useViewerFactsRequest(): () => Promise<ViewerFact[]>;
  /** Runs a recorded run again and resolves at once with its key, like a manual run. */
  useReplayRequest(): (replay: WorkflowReplay) => Promise<{ triggerId: string }>;
  /** Stops a recorded run. */
  useCancelRunRequest(): (engineRunId: string) => Promise<WorkflowCancelResult>;
  /** A recorded run with its steps, kept current by the run webhooks. Skipped (always loading) for a null run id. */
  useRun(engineRunId: string | null): Live<WorkflowRunDetail>;
  /** A workflow's recorded runs, newest first, at most `limit`. */
  useRuns(engineWorkflowId: string, limit: number): Live<RecordedWorkflowRun[]>;
  /** Subscribes to runs as the engine pushes them; returns the unsubscribe. Throws while the scope has no instance. */
  useRunsSubscription(): (onRun: (run: WorkflowRun) => void) => () => void;
  /** Enabled workflows the engine reported it could not set up. Empty when the caller cannot see the instance. */
  useNotRunning(): Live<NotRunningWorkflow[]>;
  /** Asks the engine for current workflow health. Throttled per instance; never rejects for an engine problem. */
  useHealthResyncRequest(): (trigger: WorkflowHealthResyncTrigger) => Promise<WorkflowHealthResyncResult>;
}

/**
 * Work the engine finishes after the call that started it returns, followed
 * through the transient events its callbacks leave under a correlation key.
 */
export interface RequestsGateway {
  /**
   * The latest event under a key; null until one arrives, or when the caller
   * cannot see the instance. Skipped (always loading) for a null key.
   */
  useEvent(correlationKey: string | null): Live<TransientEvent | null>;
  /**
   * Every event under a key, oldest first, for keys several runs answer to.
   * Empty when the caller cannot see the instance; skipped (always loading)
   * for a null key.
   */
  useEvents(correlationKey: string | null): Live<TransientEvent[]>;
  /**
   * Sends requests of one kind to the instance's engine under keys it makes
   * up, and reads the answer. `kind` must not change while mounted; `start`
   * throws while the scope has no instance.
   */
  useCorrelated<Kind extends CorrelatedRequestKind>(kind: Kind): Correlated<CorrelatedRequests[Kind]>;
  /**
   * Sends one request of a kind under a key the caller made up, for a caller
   * that follows the answer itself. Resolves once the engine has taken the
   * request, not when it answers. `kind` must not change while mounted.
   */
  useSendRequest<Kind extends CorrelatedRequestKind>(
    kind: Kind
  ): (request: CorrelatedRequests[Kind], correlationKey: string) => Promise<{ correlationKey: string }>;
  /**
   * Follows the latest event under a key from outside a component, such as a
   * check that awaits it. Throws while the scope has no instance.
   */
  useEventWatchRequest(): (correlationKey: string) => EventWatch;
}

/** Running the dashboard's macros. The macros themselves are kept in Convex, not on the engine. */
export interface MacrosGateway {
  /**
   * Runs a chat-command, workflow or action macro on the engine. Rejects for
   * an HTTP-request macro, which the browser fetches itself, and for a
   * chat-command macro pressed by someone who does not manage the instance.
   */
  useRunRequest(): (macroId: MacroId, values: MacroVariableValue[]) => Promise<MacroRunResult>;
}

/**
 * What the engine records about the channel's streams and the viewers who
 * support them, read on demand: no webhook mirrors these figures into Convex.
 * A recap's stored summary is Convex data; a recap's clips and markers, and a
 * viewer's Twitch profile, come from Twitch, not the engine. Also publishes
 * test events onto the engine's bus.
 */
export interface StreamOpsGateway {
  /**
   * A recapped session's per-minute viewer samples and top cheerers and
   * gifters. An engine that is unregistered or cannot answer resolves with
   * that status rather than rejecting.
   */
  useRecapEngineDetailRequest(): (sessionId: string) => Promise<StreamRecapEngineDetail>;
  /**
   * A recapped session's counted events in time order. Needs
   * `analytics.sessionEvents`; resolves with the failure like the detail.
   */
  useRecapTimelineEventsRequest(): (sessionId: string) => Promise<RecapTimelineEvents>;
  /**
   * Stores a snapshot of the engine's open session as its summary, unless a
   * fresh one is stored already; the summary itself arrives through the
   * stored-summary reads.
   */
  useOpenSessionRefreshRequest(): () => Promise<OpenSessionRefresh>;
  /** Recent streams, newest first. Rejects with the reason when the engine cannot be asked. */
  useSupporterStreamsRequest(): () => Promise<SupporterStream[]>;
  /** Top supporters, anonymous ones left out. Rejects for a stream the engine no longer has. */
  useSupporterLeaderboardRequest(): (query: SupporterLeaderboardQuery) => Promise<Supporter[]>;
  /** Rejects for a blank id. */
  useViewerSupportTotalsRequest(): (platformUserId: string) => Promise<ViewerSupportTotals>;
  /** Publishes an event as given, with no `platform` attribute. */
  usePublishEventRequest(): (event: EngineTestEvent) => Promise<PublishedTestEvent>;
  /**
   * Publishes a synthetic Twitch event, which the engine stamps
   * `platform: "twitch"` so it passes the same filters as a real one.
   */
  useSimulateTwitchEventRequest(): (event: EngineTestEvent) => Promise<PublishedTestEvent>;
}

/**
 * The engine's own configuration: backups of what it runs, and where it keeps
 * uploaded files. Who may see or change it is decided in Convex: owners and
 * admins only.
 */
export interface ConfigGateway {
  /** The configuration as backup JSON text, in chunks to join. */
  useExportRequest(): (request: ConfigExportRequest) => Promise<string[]>;
  /** What importing a backup would do, without doing it. Rejects with the engine's list of problems for a malformed one. */
  usePreviewImportRequest(): (request: ConfigImportRequest) => Promise<ConfigImportPlan>;
  /** Imports a backup. The engine plans it again, so an earlier preview is advisory only. */
  useImportRequest(): (request: ConfigImportRequest) => Promise<ConfigImportResult>;
  /** The storage backend; null when the engine is not registered or does not answer. */
  useStorageConfigRequest(): () => Promise<StorageConfig | null>;
  /** Replaces the storage backend, and its credentials, for everyone on the instance. */
  useSetStorageConfigRequest(): (config: Record<string, unknown>) => Promise<{ success: boolean }>;
}

/**
 * The live connection the engine pushes events and runs over, which the
 * subscriptions in other namespaces share. A gateway opens it to the scope's
 * engine.
 */
export interface SessionGateway {
  /** Keeps the live connection pointed at the scope's engine while mounted. Mount it once, in the app shell. */
  useLiveConnection(): void;
  /** Retries a dropped connection now instead of waiting out its backoff; does nothing while connected. */
  useReconnectRequest(): () => void;
  /** True while the connection holds an engine session that has completed an authenticated round trip. */
  useConnected(): boolean;
}

/**
 * The Twitch account the instance acts as. Owners and admins link and unlink
 * it; anyone who can see the instance reads it. Linking is a flow the UI
 * follows rather than a URL to visit, so a gateway can link with a browser
 * redirect or with a code the streamer approves elsewhere.
 */
export interface TwitchLinkGateway {
  /** The linked account; null when there is none or the caller cannot see the instance. */
  useLink(): Live<TwitchLink | null>;
  /** Starts and follows linking for the calling component. */
  useLinkFlow(): TwitchLinkFlow;
  /** Removes the link. Rejects for a caller who is not an owner or admin. */
  useUnlinkRequest(): () => Promise<void>;
}

/** The addresses a scene's overlay is served at: the one OBS loads, and previews of it. */
export interface OverlaysGateway {
  /**
   * The URL OBS loads the scene from, made on first ask and the same after
   * that until rotated. Rejects for a scene that has not reached the engine.
   */
  useBrowserSourceUrlRequest(): (sceneId: SceneId) => Promise<string>;
  /** Replaces the scene's browser-source URL; the one before stops working. */
  useRotateBrowserSourceUrlRequest(): (sceneId: SceneId) => Promise<string>;
  /**
   * A short-lived URL of the scene's live overlay, for an editor's preview.
   * Null when the scene has not reached the engine or the caller cannot see it.
   */
  usePreviewUrlRequest(): (sceneId: SceneId) => Promise<string | null>;
}

/**
 * Connecting an installed module to a provider its manifest declares under
 * `oauth[]`. The engine keeps the tokens; the provider's approval page needs
 * the browser, so connecting leaves the page and the provider sends it back.
 */
export interface ModuleOAuthGateway {
  /**
   * Sends the browser to the provider to approve, coming back to `returnTo`.
   * Rejects, before leaving, for an integration the module does not declare
   * or an engine that cannot connect one.
   */
  useConnectRequest(): (connect: ModuleOAuthConnect) => Promise<void>;
  /** Finishes the connect the provider came back with, given the one-time code it was handed. */
  useFinishRequest(): (connectCode: string) => Promise<ModuleOAuthFinish>;
}

/**
 * Bringing a setup over from another bot (Firebot, Streamer.bot): an export
 * is read into a report of the groups, counters, commands and workflows it
 * would create, which the streamer reviews before any of it reaches the
 * engine. Owners and admins only.
 */
export interface SetupImportsGateway {
  /** The instance's most recent import with its items; null when it has none. */
  useLatest(): Live<SetupImportReport | null>;
  /** Reads an export into a report to review. Rejects, with words for the streamer, an export it cannot read. */
  useAnalyzeRequest(): (analysis: SetupImportAnalysis) => Promise<{ importId: SetupImportId }>;
  /** Starts creating a reviewed import's items on the engine; each item's outcome arrives through `useLatest`. */
  useStartRequest(): (importId: SetupImportId) => Promise<void>;
  /** Tries again the items that needed a module or failed, and an import that gave up waiting. */
  useRetryRequest(): (importId: SetupImportId) => Promise<void>;
  /** Throws away an import still in review. */
  useDiscardRequest(): (importId: SetupImportId) => Promise<void>;
}

/**
 * The app's starter packs of ready-made commands and workflows, installed
 * onto the engine. The packs are the app's own; what each item made on the
 * engine is tracked so a pack shows what is already in place.
 */
export interface StarterPacksGateway {
  /** Each item's state, keyed by `starterItemKey`; null when the caller cannot see the instance. */
  useStatus(): Live<Record<string, StarterPackItemState> | null>;
  /** Installs a pack's items and resolves with how each went; an item can still be pending on the engine. */
  useInstallRequest(): (install: StarterPackInstall) => Promise<StarterPackInstallOutcome[]>;
}

// The namespaces below act on the linked Twitch channel as its broadcaster.
// A request rejects with words for the streamer, such as a missing Twitch
// permission to reconnect for, an offline channel, or Twitch's own refusal.

/** The channel's ad schedule, and snoozing the next ad. Any member may snooze. */
export interface AdBreaksGateway {
  useScheduleRequest(): () => Promise<AdSchedule>;
  useSnoozeRequest(): () => Promise<AdSnoozeResult>;
}

/**
 * Blocked terms, timeouts and bans, and chat modes. Who may do what depends
 * on the caller's role and the link's scopes; every request enforces it, and
 * `useAccess` reports it so a screen can disable and explain.
 */
export interface ModerationGateway {
  /** Null when the caller cannot see the instance. */
  useAccess(options?: ReadOptions): Live<ModerationAccess | null>;
  useBlockedTermsRequest(): () => Promise<BlockedTermList>;
  useAddBlockedTermRequest(): (text: string) => Promise<BlockedTerm>;
  useRemoveBlockedTermRequest(): (termId: string) => Promise<void>;
  /** Times out a viewer by login for `seconds`. */
  useTimeoutRequest(): (login: string, seconds: number) => Promise<ModeratedUser>;
  useBanRequest(): (login: string, reason?: string) => Promise<ModeratedUser>;
  /** Lifts a ban or a timeout. */
  useUnbanRequest(): (login: string) => Promise<ModeratedUser>;
  useChatSettingsRequest(): () => Promise<ChatSettings>;
  /** Resolves with the chat modes as Twitch holds them afterwards. */
  useUpdateChatSettingsRequest(): (patch: ChatSettingsPatch) => Promise<ChatSettings>;
}

/**
 * The chat's one pinned message, and a history of messages worth pinning
 * again. Twitch keeps a single pin per channel, so pinning replaces it.
 */
export interface PinsGateway {
  /** Newest first. Empty when the caller cannot see the instance. */
  useHistory(options?: ReadOptions): Live<PinHistoryEntry[]>;
  /** Null when nothing is pinned. A pin made outside the app joins the history the first time it is read. */
  useCurrentRequest(): () => Promise<CurrentPin | null>;
  /** Posts a message, pins it, and keeps it in the history. */
  usePinNewRequest(): (text: string) => Promise<PinnedMessage>;
  /** Pins a history entry again, posting its text anew when the original message can no longer be pinned. */
  useRepinRequest(): (entryId: PinHistoryEntryId) => Promise<RepinnedMessage>;
  useUnpinRequest(): (messageId: string) => Promise<void>;
  useRemoveFromHistoryRequest(): (entryId: PinHistoryEntryId) => Promise<void>;
}

/**
 * The shoutout queue: channels waiting for a Twitch shoutout, sent one at a
 * time within Twitch's rate limits. Workflows and chat commands add to the
 * same queue.
 */
export interface ShoutoutsGateway {
  /** In queue order. Empty when the caller cannot see the instance. */
  useQueue(options?: ReadOptions): Live<ShoutoutEntry[]>;
  /** The channel a login names, to confirm before queueing; null when there is none. */
  useLookupRequest(): (login: string) => Promise<TwitchChannel | null>;
  /** Queues a looked-up channel; a channel already waiting keeps its place. */
  useEnqueueRequest(): (channel: TwitchChannel) => Promise<void>;
  useRemoveRequest(): (entryId: ShoutoutEntryId) => Promise<void>;
  /** Puts the queue in this order, showing it at once; an entry gone meanwhile is skipped. */
  useReorderRequest(): (entryIds: ShoutoutEntryId[]) => Promise<void>;
}

/** Writing in the channel's chat as the broadcaster, and who is in it. */
export interface TwitchChatGateway {
  /** Rejects when Twitch takes the message but drops it (AutoMod, a duplicate), with its reason. */
  useSendMessageRequest(): (message: string) => Promise<void>;
  useSendAnnouncementRequest(): (announcement: Announcement) => Promise<void>;
  /** A Twitch shoutout of another channel now, by login, outside the queue. */
  useSendShoutoutRequest(): (login: string) => Promise<void>;
  /** Everyone in chat now, one page of up to a thousand. */
  useChattersRequest(): () => Promise<Chatter[]>;
}

export interface ClipsGateway {
  /** Clips the live stream. Rejects while the channel is offline or has clipping off. */
  useCreateRequest(): () => Promise<CreatedClip>;
}

/** The channel's title, category and tags, VOD markers, and named presets of the three. */
export interface StreamInfoGateway {
  /** `knownBoxArt` saves a lookup when the category has not changed. */
  useChannelRequest(): (knownBoxArt?: KnownBoxArt) => Promise<StreamInfo>;
  /** At most ten; empty for a blank query. */
  useSearchCategoriesRequest(): (query: string) => Promise<StreamCategory[]>;
  /** Writes only the fields given, so a field changed elsewhere since it was read is not reverted. */
  useUpdateRequest(): (changes: StreamInfoChanges) => Promise<StreamInfoUpdate>;
  /** Rejects while the channel is offline or keeps no VODs. */
  useCreateMarkerRequest(): (description?: string) => Promise<StreamMarker>;
  /** By name. Empty when the caller cannot see the instance. */
  usePresets(options?: ReadOptions): Live<StreamInfoPreset[]>;
  useSavePresetRequest(): (preset: NewStreamInfoPreset) => Promise<StreamInfoPresetId>;
  useRemovePresetRequest(): (presetId: StreamInfoPresetId) => Promise<void>;
}

/**
 * The go-live checklist run just before a stream: each check that asks
 * Twitch is its own request so the checks run side by side, and finishing it
 * posts the announcement and drops the start marker.
 */
export interface GoLiveGateway {
  /** Null when the caller cannot see the instance. */
  useChecklist(options?: ReadOptions): Live<GoLiveChecklistState | null>;
  /** The instance's scenes and browser sources; null when the caller cannot see the instance. */
  useOverlays(options?: ReadOptions): Live<GoLiveOverlayFacts | null>;
  /** Hides a check from the checklist, or shows it again. */
  useSetCheckDismissedRequest(): (checkId: GoLiveCheckId, dismissed: boolean) => Promise<void>;
  /** Whether Twitch still accepts the link and it holds every required scope. */
  useCheckTwitchRequest(): () => Promise<GoLiveTwitchFacts>;
  useCheckStreamInfoRequest(): () => Promise<GoLiveStreamInfoFacts>;
  /** Each step reports its own outcome rather than rejecting. */
  useCompleteRequest(): (finish: GoLiveFinish) => Promise<GoLiveCompletion>;
}
