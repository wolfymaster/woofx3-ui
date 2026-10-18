import type {
  AlertClearResult,
  AlertComposition,
  AlertOverview,
  AlertReplayResult,
  AlertSkipResult,
  ChatCommand,
  ChatCommandChanges,
  ChatCommandGroup,
  ChatCommandGroupChanges,
  CompositionPreviewUrl,
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
  EngineWorkflowOption,
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  HostedStorageUsage,
  InstanceId,
  InstanceLiveState,
  Live,
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
  ObsStatus,
  Paginated,
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
  StreamEventFrame,
  TestRunCapabilities,
  TransientEvent,
  UploadGrant,
  UploadRequest,
  WebhookEventId,
  WebhookEventSummary,
  WidgetThemes,
  Workflow,
  WorkflowCancelResult,
  WorkflowCatalog,
  WorkflowReplay,
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
  /** Runs a recorded run again and resolves at once with its key, like a manual run. */
  useReplayRequest(): (instanceId: InstanceId, replay: WorkflowReplay) => Promise<{ triggerId: string }>;
  /** Stops a recorded run. */
  useCancelRunRequest(): (instanceId: InstanceId, engineRunId: string) => Promise<WorkflowCancelResult>;
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
}

export interface OptimisticInstance {
  optimisticInstanceId: InstanceId | null;
  isInstanceLoading: boolean;
}
