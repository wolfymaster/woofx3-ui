import type {
  AlertClearResult,
  AlertComposition,
  AlertOverview,
  AlertReplayResult,
  AlertSkipResult,
  AlertTargetUsage,
  ChatCommand,
  ChatCommandChanges,
  ChatCommandGroup,
  ChatCommandGroupChanges,
  CompositionPreviewUrl,
  ConfigExportRequest,
  ConfigImportPlan,
  ConfigImportRequest,
  ConfigImportResult,
  Correlated,
  CorrelatedRequestKind,
  CorrelatedRequests,
  CreatedModuleResourceInstance,
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
  HostedStorageUsage,
  InstanceId,
  InstanceLiveState,
  Live,
  MacroId,
  MacroRunResult,
  MacroVariableValue,
  ModuleDetail,
  ModuleFileContent,
  ModuleFileList,
  ModuleId,
  ModuleResourceInstance,
  ModuleResourceInstanceChanges,
  ModuleSettingValue,
  NewChatCommand,
  NewChatCommandGroup,
  NewLibraryAlert,
  NewModuleResourceInstance,
  NewScene,
  NotRunningWorkflow,
  ObsStatus,
  OpenSessionRefresh,
  Paginated,
  PublishedTestEvent,
  RecapTimelineEvents,
  RecordedWorkflowRun,
  Resource,
  ResourceChanges,
  ResourceKindDefinition,
  ResourcePage,
  ResourceQuery,
  ResourceValues,
  SceneChanges,
  SceneEditorGrant,
  SceneRecord,
  SceneWidgetCatalogRow,
  StorageConfig,
  StreamEventFrame,
  StreamRecapEngineDetail,
  Supporter,
  SupporterLeaderboardQuery,
  SupporterStream,
  TestRunCapabilities,
  TransientEvent,
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
 * (namespaces.ts lists every domain; this interface gains each one as its
 * call sites move behind it).
 *
 * Members are React hooks. A gateway is chosen once when the app boots and
 * never swapped, so a component calls the same hooks in the same order on
 * every render. A member named `use...Request` returns a stable function that
 * performs one call; any other member is a read.
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
}

/** Engine reachability, version, features and stream state. */
export interface StatusGateway {
  /** Rejects when the caller is not a member, the instance has no engine, or the engine cannot be asked. */
  useCapabilitiesRequest(): (instanceId: InstanceId) => Promise<EngineCapabilityReport>;
  /** Null when the engine is not registered or did not answer. */
  useEngineInfoRequest(): (instanceId: InstanceId) => Promise<EngineInfo | null>;
  useSetOverlayPublicUrlRequest(): (instanceId: InstanceId, value: string) => Promise<{ success: boolean }>;
  /** Pings an engine by URL, before or apart from registration. Resolves with the failure rather than rejecting. */
  useConnectionTestRequest(): (url: string) => Promise<EngineConnectionTest>;
  useObsStatusRequest(): (instanceId: InstanceId) => Promise<ObsStatus>;
  /**
   * The instance's live state, read with the scope's optimistic id. While that
   * id is unconfirmed an error reads as loading, because a cached id can be
   * malformed for this deployment and is replaced one round trip later.
   */
  useLiveState(scope: OptimisticInstance): Live<InstanceLiveState | null>;
  /** Asks the engine for the stream state now rather than waiting for its callbacks. */
  useLiveStatePollRequest(): (instanceId: InstanceId) => Promise<{ ok: boolean }>;
  /** Null when the caller cannot see the instance. Skipped (always loading) for a null id. */
  useSyncState(instanceId: InstanceId | null): Live<EngineSyncState | null>;
  useSyncRequest(): (instanceId: InstanceId) => Promise<EngineSyncRequest>;
}

/** The engine's uploaded files and folders. */
export interface ResourcesGateway {
  useListRequest(): (instanceId: InstanceId, query: ResourceQuery) => Promise<ResourcePage>;
  /** Null when the instance is not on hosted storage. */
  useHostedStorageUsageRequest(): (instanceId: InstanceId) => Promise<HostedStorageUsage | null>;
  /** Reserves a pending resource and returns where to PUT its bytes. Rejects when a plan limit refuses it. */
  useUploadGrantRequest(): (instanceId: InstanceId, file: UploadRequest) => Promise<UploadGrant>;
  /** Marks a granted upload's bytes as landed. */
  useCompleteUploadRequest(): (instanceId: InstanceId, resourceId: string) => Promise<Resource>;
  /** Asks for a derived file such as a thumbnail; resolves once the request is accepted, not when it is done. */
  useProcessingRequest(): (
    instanceId: InstanceId,
    resourceId: string,
    utility: string
  ) => Promise<{ accepted: boolean }>;
  useCreateFolderRequest(): (instanceId: InstanceId, name: string, parentId: string | null) => Promise<Resource>;
  /** Renames (`name`) or moves (`parentId`) a resource. */
  useUpdateRequest(): (instanceId: InstanceId, resourceId: string, changes: ResourceChanges) => Promise<Resource>;
  useRemoveRequest(): (instanceId: InstanceId, resourceId: string) => Promise<{ deleted: boolean }>;
}

/**
 * Events the engine received: the callbacks Convex recorded (the webhook log,
 * kept for debugging and retriggering), and the engine's own event log with
 * its live push and type selection.
 */
export interface EventLogGateway {
  /** Newest first, optionally of one type. Skipped (always loading) for a null id. */
  useWebhookEvents(
    instanceId: InstanceId | null,
    eventType: string | null,
    initialNumItems: number
  ): Paginated<WebhookEventSummary>;
  /** The raw payload JSON; null when the entry is gone or not the caller's. */
  useWebhookPayload(logId: WebhookEventId): Live<string | null>;
  /** Fires a logged event's type and payload at the engine again. */
  useRetriggerRequest(): (
    instanceId: InstanceId,
    logId: WebhookEventId
  ) => Promise<{ success: boolean; message: string }>;
  /** Subscribes to pushed events of `types` (null: every type the engine pushes); returns the unsubscribe. */
  useStreamEventsSubscription(): (
    instanceId: string,
    types: readonly string[] | null,
    onFrame: (frame: StreamEventFrame) => void
  ) => () => void;
  /** A page of the engine's event log. Needs `events.log`. */
  useEventsRequest(): (instanceId: string, query?: EventLogQuery) => Promise<EventLogPage>;
  /** Which event types the engine logs and pushes, and which it offers. Needs `events.log`. */
  useSettingsRequest(): (instanceId: string) => Promise<EventLogSettings>;
  /** Replaces the engine's selection and resolves with the settings it results in. */
  useSetSelectionRequest(): (instanceId: string, selection: EventLogSelection) => Promise<EventLogSettings>;
}

/** The alerts the engine dispatched, as its callbacks report them, and its overlay queue. */
export interface AlertQueueGateway {
  /** Newest first. Empty when the caller cannot see the instance; skipped (always loading) for a null id. */
  useAlerts(instanceId: InstanceId | null, limit: number): Live<EngineAlert[]>;
  /**
   * Totals by outcome and hourly buckets for the window ending with the hour
   * starting at `hourStart` (epoch ms on the hour). Null when the caller cannot
   * see the instance; skipped (always loading) for a null id.
   */
  useOverview(instanceId: InstanceId | null, hourStart: number): Live<AlertOverview | null>;
  /** Plays a recorded alert again. Resolves with the engine's answer, including a refusal. */
  useReplayRequest(): (instanceId: InstanceId, engineAlertId: string) => Promise<AlertReplayResult>;
  /** Ends the alert playing on every open overlay. */
  useSkipCurrentRequest(): (instanceId: InstanceId) => Promise<AlertSkipResult>;
  /** Drops every alert still waiting; the one playing keeps playing. */
  useClearQueueRequest(): (instanceId: InstanceId) => Promise<AlertClearResult>;
}

/**
 * The engine's library of reusable alerts, read from the cache its webhooks
 * keep in Convex, and the page that previews a composition.
 */
export interface AlertLibraryGateway {
  /** By name. Empty when the caller cannot see the instance; skipped (always loading) for a null id. */
  useAlerts(instanceId: InstanceId | null): Live<AlertComposition[]>;
  /** Null until its webhook arrives, once it is deleted, or when the caller cannot see the instance. */
  useAlert(instanceId: InstanceId, engineCompositionId: string): Live<AlertComposition | null>;
  /** Reads the engine's whole library into the cache, for alerts no webhook brought. */
  useRefreshRequest(): (instanceId: InstanceId) => Promise<{ count: number }>;
  /** Rejects when the engine keeps no alert library or the name is blank. */
  useCreateRequest(): (instanceId: InstanceId, alert: NewLibraryAlert) => Promise<{ engineCompositionId: string }>;
  useRemoveRequest(): (instanceId: InstanceId, engineCompositionId: string) => Promise<{ success: boolean }>;
  /** A short-lived URL of the engine's composition preview page; null when the engine has none. */
  usePreviewUrlRequest(): (instanceId: InstanceId) => Promise<CompositionPreviewUrl | null>;
}

/**
 * Chat commands and the user groups that may run them. Reads come from the
 * mirror the engine's webhooks keep in Convex; writes go to the engine, and
 * their result reaches the mirror the same way.
 */
export interface CommandsGateway {
  /** Empty when the caller cannot see the instance; skipped (always loading) for a null id. */
  useCommands(instanceId: InstanceId | null): Live<ChatCommand[]>;
  /** Empty when the caller cannot see the instance; skipped (always loading) for a null id. */
  useGroups(instanceId: InstanceId | null): Live<ChatCommandGroup[]>;
  /** One group's usernames. */
  useGroupMembers(instanceId: InstanceId, engineGroupId: string): Live<string[]>;
  useCreateCommandRequest(): (instanceId: InstanceId, command: NewChatCommand) => Promise<{ engineCommandId: string }>;
  useUpdateCommandRequest(): (
    instanceId: InstanceId,
    command: ChatCommandChanges
  ) => Promise<{ engineCommandId: string }>;
  useDeleteCommandRequest(): (instanceId: InstanceId, engineCommandId: string) => Promise<{ deleted: boolean }>;
  useCreateGroupRequest(): (instanceId: InstanceId, group: NewChatCommandGroup) => Promise<{ engineGroupId: string }>;
  useUpdateGroupRequest(): (
    instanceId: InstanceId,
    group: ChatCommandGroupChanges
  ) => Promise<{ engineGroupId: string }>;
  useDeleteGroupRequest(): (instanceId: InstanceId, engineGroupId: string) => Promise<{ deleted: boolean }>;
  useAddGroupMemberRequest(): (
    instanceId: InstanceId,
    engineGroupId: string,
    username: string
  ) => Promise<{ ok: true }>;
  useRemoveGroupMemberRequest(): (
    instanceId: InstanceId,
    engineGroupId: string,
    username: string
  ) => Promise<{ ok: true }>;
}

/**
 * Runtime instances of the resource kinds installed modules declare (counters,
 * timers, queues), their values, and the kinds themselves. Reads come from the
 * mirror the engine's webhooks keep in Convex; writes go to the engine.
 */
export interface ModuleResourcesGateway {
  /** Every resource instance. Empty when the caller cannot see the instance; skipped (always loading) for a null id. */
  useInstances(instanceId: InstanceId | null): Live<ModuleResourceInstance[]>;
  /** One installed module's instances. Skipped (always loading) unless both ids are set. */
  useModuleInstances(instanceId: InstanceId | null, moduleId: ModuleId | null): Live<ModuleResourceInstance[]>;
  /**
   * The instances of one kind: `module:kind`, or a bare kind. Skipped (always
   * loading) for a null id or kind.
   */
  useKindInstances(instanceId: InstanceId | null, kind: string | null): Live<ModuleResourceInstance[]>;
  /**
   * The instances of several kinds in one read, each `module:kind` or bare.
   * Skipped (always loading) for a null id or no kinds.
   */
  useKindsInstances(instanceId: InstanceId | null, kinds: readonly string[]): Live<ModuleResourceInstance[]>;
  /** Every mirrored value, keyed by canonical id. Skipped (always loading) for a null id. */
  useValues(instanceId: InstanceId | null): Live<ResourceValues>;
  /**
   * The module providing a kind, and its declaration; null when no installed
   * module declares it. Skipped (always loading) for a null id or kind.
   */
  useKind(instanceId: InstanceId | null, kind: string | null): Live<ResourceKindDefinition | null>;
  /** Every kind the installed modules declare. Skipped (always loading) for a null id. */
  useKinds(instanceId: InstanceId | null): Live<DeclaredResourceKind[]>;
  useCreateRequest(): (
    instanceId: InstanceId,
    resource: NewModuleResourceInstance
  ) => Promise<CreatedModuleResourceInstance>;
  useUpdateRequest(): (instanceId: InstanceId, changes: ModuleResourceInstanceChanges) => Promise<null>;
  useRemoveRequest(): (instanceId: InstanceId, canonicalId: string) => Promise<null>;
  /** Reads one module's instances from the engine into the mirror, for any no webhook brought. */
  useSyncModuleRequest(): (instanceId: InstanceId, moduleId: ModuleId) => Promise<{ itemsProcessed: number }>;
  /** Reads the current value of every instance of a kind from the engine into the mirror. */
  useRefreshValuesRequest(): (instanceId: InstanceId, kind: string) => Promise<null>;
  /**
   * Runs action steps on the engine now. `actions` carry their `$` keys escaped
   * (lib/dollar-keys); the result arrives through the values they change.
   */
  useRunActionsRequest(): (instanceId: InstanceId, label: string, actions: unknown[]) => Promise<null>;
}

/**
 * Installed modules as the engine runs them: their detail, settings and files,
 * and uninstalling them. `moduleId` is what the module detail was asked for
 * with (an installed module's key or a marketplace id) unless typed `ModuleId`.
 */
export interface ModulesGateway {
  /** The module's manifest-derived detail, merged with its marketplace listing when it has one. */
  useDetailRequest(): (instanceId: InstanceId, moduleId: string) => Promise<ModuleDetail>;
  /** The declared settings' current values; a secret's value never comes back, only whether one is set. */
  useSettingsRequest(): (instanceId: InstanceId, moduleId: string) => Promise<ModuleSettingValue[]>;
  /** Rejects for a key the module does not declare as a setting. */
  useUpdateSettingRequest(): (
    instanceId: InstanceId,
    moduleId: string,
    key: string,
    value: string
  ) => Promise<ModuleSettingValue>;
  useFilesRequest(): (instanceId: InstanceId, moduleId: string) => Promise<ModuleFileList>;
  useFileRequest(): (instanceId: InstanceId, moduleId: string, path: string) => Promise<ModuleFileContent>;
  /**
   * Asks the engine to uninstall; resolves with the key its outcome is
   * reported under (`transientEvents`), not when the module is gone.
   */
  useUninstallRequest(): (instanceId: InstanceId, moduleId: ModuleId) => Promise<{ moduleKey: string }>;
  /** Asks the engine whether an uninstall whose outcome never arrived took effect, and settles the mirror. */
  useReconcileUninstallRequest(): (
    instanceId: InstanceId,
    moduleId: ModuleId,
    correlationKey: string
  ) => Promise<{ stillInstalled: boolean }>;
  /** The engine's workflows, by id and name. */
  useWorkflowsRequest(): (instanceId: InstanceId) => Promise<EngineWorkflowOption[]>;
  /**
   * Installs or updates a marketplace module; resolves with the key its
   * progress and outcome are reported under (`transientEvents`), not when it
   * is installed. Rejects when the archive declares a permission or local
   * endpoint (by id) outside the approved lists.
   */
  useMarketplaceInstallRequest(): (
    instanceId: InstanceId,
    marketplaceModuleId: string,
    approvedPermissions: string[],
    approvedLocalEndpoints: string[]
  ) => Promise<{ moduleKey: string }>;
}

/**
 * Overlay scenes and the widgets they place. Reads come from the cache the
 * engine's webhooks keep in Convex; writes go to the engine, and their result
 * reaches the cache the same way.
 */
export interface ScenesGateway {
  /** Every scene. Empty when the caller cannot see the instance; skipped (always loading) for a null id. */
  useScenes(instanceId: InstanceId | null): Live<SceneRecord[]>;
  /** One scene by the engine's id; null until its webhook arrives, or when the caller cannot see the instance. */
  useScene(instanceId: InstanceId, engineSceneId: string): Live<SceneRecord | null>;
  /**
   * The widgets the instance can place, with the name of the module providing
   * each. Empty when the caller cannot see the instance; skipped (always
   * loading) for a null id.
   */
  useWidgetCatalog(instanceId: InstanceId | null): Live<SceneWidgetCatalogRow[]>;
  /**
   * Every name an alert widget on the instance's scenes answers to, the
   * default first. Empty when the caller cannot see the instance; skipped
   * (always loading) for a null id.
   */
  useAlertWidgetNames(instanceId: InstanceId | null): Live<string[]>;
  /**
   * What one scene's editor needs to warn that an edit leaves Alert steps
   * with no alert widget to play on: every Alert step's target, and the names
   * the alert widgets of the instance's other scenes answer to. Null when the
   * caller cannot see the instance.
   */
  useAlertTargetUsage(instanceId: InstanceId, engineSceneId: string): Live<AlertTargetUsage | null>;
  useCreateRequest(): (instanceId: InstanceId, scene: NewScene) => Promise<{ engineSceneId: string }>;
  useUpdateRequest(): (
    instanceId: InstanceId,
    engineSceneId: string,
    changes: SceneChanges
  ) => Promise<{ success: boolean }>;
  useRemoveRequest(): (instanceId: InstanceId, engineSceneId: string) => Promise<{ success: boolean }>;
  /** The installed themes made for one widget. */
  useWidgetThemesRequest(): (instanceId: InstanceId, widgetCanonicalId: string) => Promise<WidgetThemes>;
  /**
   * A short-lived token for sceneManager's editor socket for one scene, and
   * the socket's path. Null when the engine does not know the scene or cannot
   * reach sceneManager. Needs `scenes.editorSync`.
   */
  useEditorSessionRequest(): (instanceId: InstanceId, engineSceneId: string) => Promise<SceneEditorGrant | null>;
}

/**
 * Workflows and the catalog the builder composes them from. Reads come from
 * the mirror the engine's webhooks keep in Convex.
 */
export interface WorkflowsGateway {
  /** Every workflow. Empty when the caller cannot see the instance; skipped (always loading) for a null id. */
  useWorkflows(instanceId: InstanceId | null): Live<Workflow[]>;
  /** Whether the instance has any workflow; null while the caller's membership cannot be confirmed. */
  useHasAny(instanceId: InstanceId): Live<boolean | null>;
  /**
   * One workflow by the engine's id; null until its webhook arrives, or when
   * the caller cannot see the instance. Skipped (always loading) for a null id
   * or engine id.
   */
  useWorkflow(instanceId: InstanceId | null, engineWorkflowId: string | null): Live<Workflow | null>;
  /** Null when the caller cannot see the instance; skipped (always loading) for a null id. */
  useCatalog(instanceId: InstanceId | null): Live<WorkflowCatalog | null>;
  /**
   * Creates a workflow from a definition with its `$` keys escaped
   * (lib/dollar-keys), and resolves once its webhook echo has landed, with
   * the id the engine gave it.
   */
  useCreateRequest(): (instanceId: InstanceId, definition: unknown) => Promise<{ engineWorkflowId: string }>;
  /** Replaces a workflow's definition (`$` keys escaped); resolves once its webhook echo has landed. */
  useUpdateRequest(): (
    instanceId: InstanceId,
    engineWorkflowId: string,
    definition: unknown
  ) => Promise<{ engineWorkflowId: string }>;
  /** Resolves once the delete's webhook echo has landed. */
  useRemoveRequest(): (instanceId: InstanceId, engineWorkflowId: string) => Promise<{ deleted: true }>;
  /** Resolves once the change's webhook echo has landed. */
  useSetEnabledRequest(): (
    instanceId: InstanceId,
    engineWorkflowId: string,
    isEnabled: boolean
  ) => Promise<{ isEnabled: boolean }>;
  /** Starts a manual run and resolves at once with its key; the run's progress arrives in transient events. */
  useTriggerRequest(): (instanceId: InstanceId, run: WorkflowTrigger) => Promise<WorkflowTriggerResult>;
  /** Probes whether the engine takes test-run options, without starting a run. */
  useTestRunCapabilitiesRequest(): (instanceId: InstanceId) => Promise<TestRunCapabilities>;
  /** The values `${viewer.*}` resolves on the engine. Needs `workflow.viewerFacts`. */
  useViewerFactsRequest(): (instanceId: InstanceId) => Promise<ViewerFact[]>;
  /** Runs a recorded run again and resolves at once with its key, like a manual run. */
  useReplayRequest(): (instanceId: InstanceId, replay: WorkflowReplay) => Promise<{ triggerId: string }>;
  /** Stops a recorded run. */
  useCancelRunRequest(): (instanceId: InstanceId, engineRunId: string) => Promise<WorkflowCancelResult>;
  /**
   * A recorded run with its steps, kept current by the run webhooks. Skipped
   * (always loading) for a null id or run id.
   */
  useRun(instanceId: InstanceId | null, engineRunId: string | null): Live<WorkflowRunDetail>;
  /** A workflow's recorded runs, newest first, at most `limit`. */
  useRuns(instanceId: InstanceId, engineWorkflowId: string, limit: number): Live<RecordedWorkflowRun[]>;
  /** Subscribes to runs as the engine pushes them; returns the unsubscribe. */
  useRunsSubscription(): (instanceId: string, onRun: (run: WorkflowRun) => void) => () => void;
  /**
   * Enabled workflows the engine reported it could not set up. Empty when the
   * caller cannot see the instance; skipped (always loading) for a null id.
   */
  useNotRunning(instanceId: InstanceId | null): Live<NotRunningWorkflow[]>;
  /** Asks the engine for current workflow health. Throttled per instance; never rejects for an engine problem. */
  useHealthResyncRequest(): (
    instanceId: InstanceId,
    trigger: WorkflowHealthResyncTrigger
  ) => Promise<WorkflowHealthResyncResult>;
}

/**
 * Work the engine finishes after the call that started it returns, followed
 * through the transient events its callbacks leave under a correlation key.
 */
export interface RequestsGateway {
  /**
   * The latest event under a key; null until one arrives, or when the caller
   * cannot see the instance. Skipped (always loading) for a null id or key.
   */
  useEvent(instanceId: InstanceId | null, correlationKey: string | null): Live<TransientEvent | null>;
  /**
   * Every event under a key, oldest first, for keys several runs answer to.
   * Empty when the caller cannot see the instance; skipped (always loading)
   * for a null id or key.
   */
  useEvents(instanceId: InstanceId | null, correlationKey: string | null): Live<TransientEvent[]>;
  /**
   * Sends requests of one kind to the instance's engine under keys it makes
   * up, and reads the answer. `kind` must not change while mounted.
   */
  useCorrelated<Kind extends CorrelatedRequestKind>(
    kind: Kind,
    instanceId: InstanceId | null
  ): Correlated<CorrelatedRequests[Kind]>;
  /**
   * Sends one request of a kind under a key the caller made up, for a caller
   * that follows the answer itself. Resolves once the engine has taken the
   * request, not when it answers. `kind` must not change while mounted.
   */
  useSendRequest<Kind extends CorrelatedRequestKind>(
    kind: Kind
  ): (
    instanceId: InstanceId,
    request: CorrelatedRequests[Kind],
    correlationKey: string
  ) => Promise<{ correlationKey: string }>;
  /** Follows the latest event under a key from outside a component, such as a check that awaits it. */
  useEventWatchRequest(): (instanceId: InstanceId, correlationKey: string) => EventWatch;
}

/** Running the dashboard's macros. The macros themselves are kept in Convex, not on the engine. */
export interface MacrosGateway {
  /**
   * Runs a chat-command, workflow or action macro on the engine. Rejects for
   * an HTTP-request macro, which the browser fetches itself, and for a
   * chat-command macro pressed by someone who does not manage the instance.
   */
  useRunRequest(): (instanceId: InstanceId, macroId: MacroId, values: MacroVariableValue[]) => Promise<MacroRunResult>;
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
  useRecapEngineDetailRequest(): (instanceId: InstanceId, sessionId: string) => Promise<StreamRecapEngineDetail>;
  /**
   * A recapped session's counted events in time order. Needs
   * `analytics.sessionEvents`; resolves with the failure like the detail.
   */
  useRecapTimelineEventsRequest(): (instanceId: InstanceId, sessionId: string) => Promise<RecapTimelineEvents>;
  /**
   * Stores a snapshot of the engine's open session as its summary, unless a
   * fresh one is stored already; the summary itself arrives through the
   * stored-summary reads.
   */
  useOpenSessionRefreshRequest(): (instanceId: InstanceId) => Promise<OpenSessionRefresh>;
  /** Recent streams, newest first. Rejects with the reason when the engine cannot be asked. */
  useSupporterStreamsRequest(): (instanceId: InstanceId) => Promise<SupporterStream[]>;
  /** Top supporters, anonymous ones left out. Rejects for a stream the engine no longer has. */
  useSupporterLeaderboardRequest(): (instanceId: InstanceId, query: SupporterLeaderboardQuery) => Promise<Supporter[]>;
  /** Rejects for a blank id. */
  useViewerSupportTotalsRequest(): (instanceId: InstanceId, platformUserId: string) => Promise<ViewerSupportTotals>;
  /** Publishes an event as given, with no `platform` attribute. */
  usePublishEventRequest(): (instanceId: InstanceId, event: EngineTestEvent) => Promise<PublishedTestEvent>;
  /**
   * Publishes a synthetic Twitch event, which the engine stamps
   * `platform: "twitch"` so it passes the same filters as a real one.
   */
  useSimulateTwitchEventRequest(): (instanceId: InstanceId, event: EngineTestEvent) => Promise<PublishedTestEvent>;
}

/**
 * The engine's own configuration: backups of what it runs, and where it keeps
 * uploaded files. Who may see or change it is decided in Convex: owners and
 * admins only.
 */
export interface ConfigGateway {
  /** The configuration as backup JSON text, in chunks to join. */
  useExportRequest(): (instanceId: InstanceId, request: ConfigExportRequest) => Promise<string[]>;
  /** What importing a backup would do, without doing it. Rejects with the engine's list of problems for a malformed one. */
  usePreviewImportRequest(): (instanceId: InstanceId, request: ConfigImportRequest) => Promise<ConfigImportPlan>;
  /** Imports a backup. The engine plans it again, so an earlier preview is advisory only. */
  useImportRequest(): (instanceId: InstanceId, request: ConfigImportRequest) => Promise<ConfigImportResult>;
  /** The storage backend; null when the engine is not registered or does not answer. */
  useStorageConfigRequest(): (instanceId: InstanceId) => Promise<StorageConfig | null>;
  /** Replaces the storage backend, and its credentials, for everyone on the instance. */
  useSetStorageConfigRequest(): (
    instanceId: InstanceId,
    config: Record<string, unknown>
  ) => Promise<{ success: boolean }>;
}

export interface OptimisticInstance {
  optimisticInstanceId: InstanceId | null;
  isInstanceLoading: boolean;
}
