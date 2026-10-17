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
  EngineAlert,
  EngineCapabilityReport,
  EngineConnectionTest,
  EngineInfo,
  EngineSyncRequest,
  EngineSyncState,
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  HostedStorageUsage,
  InstanceId,
  InstanceLiveState,
  Live,
  NewChatCommand,
  NewChatCommandGroup,
  NewLibraryAlert,
  ObsStatus,
  Paginated,
  Resource,
  ResourceChanges,
  ResourcePage,
  ResourceQuery,
  StreamEventFrame,
  UploadGrant,
  UploadRequest,
  WebhookEventId,
  WebhookEventSummary,
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

export interface OptimisticInstance {
  optimisticInstanceId: InstanceId | null;
  isInstanceLoading: boolean;
}
