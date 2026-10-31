// The types every EngineGateway speaks. They describe the engine's data as the
// UI uses it, whoever serves it: a gateway maps its own storage or wire shapes
// into these at its edge, so nothing here may name a gateway's backend.

import type { ListingType } from "@shared/marketplace-catalog";
import type { SceneEditorSession, WidgetThemes } from "@woofx3/api";
import type { ConfigField } from "@woofx3/api/ui-schema";

export type {
  AlertClearResult,
  AlertReplayResult,
  AlertSkipResult,
  EngineInfo,
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  ModuleFileContent,
  ModuleFileList,
  ObsStatus,
  SceneRepairResult,
  StorageConfig,
  StreamEventFrame,
  UploadGrant,
  ViewerFact,
  WidgetThemes,
} from "@woofx3/api";

/**
 * The installed themes made for one widget, or `unavailable` when they could
 * not be read. A theme picker shows that rather than failing the form around it.
 */
export type WidgetThemesRead = { status: "loaded"; themes: WidgetThemes["themes"] } | { status: "unavailable" };

/** One file a module ships, as an action's `asset` field offers it. */
export type { ModuleAssetOption as ModuleAsset } from "@shared/module-assets";

/** A grant to open sceneManager's editor socket for one scene. */
export type SceneEditorGrant = SceneEditorSession;

// ==================== Identities ====================

/**
 * An opaque id a gateway issued. Branded so ids of different things cannot be
 * swapped for each other, or for a backend's own id type, without a gateway
 * converting them.
 */
type GatewayId<Name extends string> = string & { readonly __gatewayId: Name };

/** The instance a call is for: one engine deployment. */
export type InstanceId = GatewayId<"instance">;

/** An installed module, as the gateway that lists installed modules knows it. */
export type ModuleId = GatewayId<"module">;

/** A dashboard macro. Macros are kept by the dashboard; only running one reaches the engine. */
export type MacroId = GatewayId<"macro">;

/** A callback recorded from the engine, kept for debugging. */
export type WebhookEventId = GatewayId<"webhookEvent">;

/**
 * A scene as the gateway that lists scenes knows it. The engine's own id for
 * the scene is `engineSceneId`; this one keys the gateway's copy of it.
 */
export type SceneId = GatewayId<"scene">;

/** An import of another bot's setup, as the gateway that keeps imports knows it. */
export type SetupImportId = GatewayId<"setupImport">;

/** A message kept in the pinned-message history, as the gateway that keeps the history knows it. */
export type PinHistoryEntryId = GatewayId<"pinHistoryEntry">;

/** A channel waiting in the shoutout queue, as the gateway that keeps the queue knows it. */
export type ShoutoutEntryId = GatewayId<"shoutoutEntry">;

/** A saved stream info preset, as the gateway that keeps presets knows it. */
export type StreamInfoPresetId = GatewayId<"streamInfoPreset">;

/** A saved stream highlight, as the gateway that keeps highlights knows it. */
export type StreamHighlightId = GatewayId<"streamHighlight">;

// ==================== Read shapes ====================

/**
 * A subscribed read: `undefined` while loading, the value once known, and a
 * thrown error on failure.
 */
export type Live<T> = T | undefined;

/**
 * A fetch-and-refetch read, for data that cannot be subscribed to. `data`
 * keeps the previous answer while a newer request is loading, and is cleared
 * by an error. Every write that changes the data has to call `refetch`.
 */
export interface Fetched<T> {
  data: T | undefined;
  isLoading: boolean;
  /** The failed request's message; null while loading and after a success. */
  error: string | null;
  refetch: () => void;
}

/**
 * A paged subscribed read: `results` grows as `loadMore` brings in pages, and
 * every loaded page stays live.
 */
export interface Paginated<T> {
  results: T[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  isLoading: boolean;
  loadMore: (numItems: number) => void;
}

/** For a read whose caller may not want it yet. */
export interface ReadOptions {
  /** False asks nothing and the read stays loading. Defaults to true. */
  enabled?: boolean;
}

/** Which instance the gateway and the engine hooks act on, set by `EngineScopeProvider`. */
export interface EngineScope {
  /** The confirmed current instance, or null while the membership list loads or when there is none. */
  instanceId: InstanceId | null;
  /**
   * The id selected last session until the membership list loads, then the
   * confirmed id. Only for reads that answer an instance the caller cannot
   * see with nothing.
   */
  optimisticInstanceId: InstanceId | null;
  /** True until the membership list loads, while `optimisticInstanceId` is unconfirmed. */
  isInstanceLoading: boolean;
}

// ==================== Status ====================

/** The engine features this UI knows how to detect. */
export type EngineCapability =
  | "alerts.compositionLayout"
  | "alerts.queueControls"
  | "analytics.aggregates"
  | "analytics.gauges"
  | "analytics.sessionEvents"
  | "analytics.sessions"
  | "assets.sizedUploads"
  | "compositions.alerts"
  | "compositions.preview"
  | "config.bundles"
  | "events.log"
  | "modules.files"
  | "modules.localEndpoints"
  | "modules.marketplaceInstall"
  | "modules.oauth"
  | "modules.storageUsage"
  | "obs.control"
  | "obs.status"
  | "scenes.behaviors"
  | "scenes.editorSessions"
  | "scenes.editorSync"
  | "scenes.repair"
  | "twitch.ads"
  | "twitch.chat"
  | "twitch.clips"
  | "twitch.dashboardTokens"
  | "twitch.moderation"
  | "twitch.pins"
  | "twitch.streamInfo"
  | "widgets.themes"
  | "workflow.conditionListReferences"
  | "workflow.delayWait"
  | "workflow.dryRun"
  | "workflow.health"
  | "workflow.realCancel"
  | "workflow.testRunOptions"
  | "workflow.viewerFacts";

/**
 * What an engine supports, as far as this UI cares. `legacy` is an engine
 * that predates capability reports and so supports none of them.
 */
export interface EngineCapabilityReport {
  legacy: boolean;
  /** Known ids only, sorted and unique. */
  capabilities: EngineCapability[];
}

/** The instance's stream state, kept current by engine callbacks and polls. */
export interface InstanceLiveState {
  isLive: boolean;
  twitchUserId?: string;
  /** ISO time the stream went online; cleared when it goes offline. */
  startedAt?: string;
  /** The logical session, which spans brief dropouts and so outlives `startedAt`. */
  sessionId?: string;
  sessionStartedAt?: string;
  streamTitle?: string;
  gameName?: string;
  viewerCount?: number;
  lastUpdateSource: "webhook" | "poll";
  /** Epoch ms. */
  lastUpdatedAt: number;
}

/** The step of a mirror sync that copies one kind of engine data. */
export type EngineSyncStepName =
  | "actions"
  | "widgets"
  | "modules"
  | "workflows"
  | "scenes"
  | "commands"
  | "groups"
  | "functions"
  | "triggers"
  | "resources";

/** When the instance's mirror last synced and when it may sync next. Times are epoch ms. */
export interface EngineSyncSchedule {
  status: "running" | "error" | "success" | "idle";
  nextEligibleAt: number;
  lastError: string;
  lastSyncedAt: number;
  lastDurationMs: number;
  consecutiveErrorCount: number;
  syncIntervalMs: number;
}

/** One sync of the mirror and its steps. Times are epoch ms. */
export interface EngineSyncRun {
  id: string;
  trigger: "manual" | "scheduled" | "registration";
  status: "running" | "error" | "success";
  startedAt: number;
  completedAt?: number;
  error?: string;
  steps: {
    name: EngineSyncStepName;
    status: "pending" | "running" | "error" | "success";
    itemsProcessed: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
  }[];
}

/** The mirror's sync bookkeeping: the schedule plus the five most recent runs. */
export interface EngineSyncState {
  syncState: EngineSyncSchedule | null;
  currentRun: EngineSyncRun | null;
  recentRuns: EngineSyncRun[];
}

export type EngineSyncRequest = { scheduled: true } | { scheduled: false; reason: "already-running" };

export type EngineConnectionTest = { ok: true } | { ok: false; error: string };

// ==================== Resources ====================

/** An uploaded file or a folder. Times are ISO strings. */
export interface Resource {
  id: string;
  name: string;
  parentId: string | null;
  isFolder: boolean;
  kind: string;
  contentType: string;
  size: number;
  status: string;
  url: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourcePage {
  resources: Resource[];
  total: number;
  page: number;
  pageSize: number;
}

/** What the instance's hosted storage holds against its plan; a null limit is unlimited. */
export interface HostedStorageUsage {
  usedBytes: number;
  limitBytes: number | null;
  fileLimitBytes: number | null;
}

/**
 * What the instance's modules keep in module storage against the plan's
 * limit. The limit is soft: nothing refuses a write past it, so `over` only
 * decides whether the owner is warned. A null limit is unlimited.
 */
export interface ModuleStorageUsage {
  usedBytes: number;
  limitBytes: number | null;
  over: boolean;
}

export interface ResourceQuery {
  folderId?: string | null;
  kind?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/** The file an upload grant is asked for; the grant is bound to `size`. */
export interface UploadRequest {
  name: string;
  contentType: string;
  parentId: string | null;
  size: number;
}

/** A rename (`name`), a move (`parentId`), or both. */
export interface ResourceChanges {
  name?: string;
  parentId?: string | null;
}

// ==================== Event log ====================

/** One webhook log entry without its payload, which is read on its own. */
export interface WebhookEventSummary {
  id: WebhookEventId;
  eventType: string;
  /** Whether the engine sent it, or the dashboard fired it again. */
  source: "webhook" | "retrigger";
  /** Epoch ms. */
  receivedAt: number;
  payloadLength: number;
}

// ==================== Alerts ====================

export type EngineAlertStatus =
  | "sent"
  | "playing"
  | "completed"
  | "failed"
  | "replayed"
  | "timed_out"
  | "skipped"
  | "pending"
  | "dispatched"
  | "unknown";

/** One alert the engine dispatched, kept current by its `alert.*` callbacks. */
export interface EngineAlert {
  /** The gateway's id of the record, for keys. */
  id: string;
  engineAlertId: string;
  status: EngineAlertStatus;
  /** The alert's JSON as the engine sent it. */
  payload?: string;
  workflowId?: string;
  sourceEventId?: string;
  engineStatus?: string;
  envelopeId?: string;
  dispatchedAt?: string;
  playedAt?: string;
  completedAt?: string;
  error?: string;
  engineCreatedAt?: string;
  engineUpdatedAt?: string;
  engineVersion?: number;
  /** Epoch ms the dashboard first heard of the alert. */
  createdAt: number;
  /** Epoch ms of the last callback that moved the alert on. */
  progressedAt?: number;
  /** Epoch ms the alert was marked unconfirmed for going quiet mid-flight. */
  unconfirmedAt?: number;
}

/** How alerts have gone over a window: totals by outcome and one bucket per hour. Times are epoch ms. */
export interface AlertOverview {
  hours: number;
  since: number;
  bucketMs: number;
  /** True when the window held more alerts than were counted, so the counts cover the newest only. */
  truncated: boolean;
  totals: {
    total: number;
    completed: number;
    failed: number;
    inFlight: number;
    unconfirmed: number;
    skipped: number;
    replayed: number;
  };
  buckets: { start: number; total: number; failed: number }[];
}

/** One alert in the engine's library. The composition parts are the engine's stored JSON, parsed. */
export interface AlertComposition {
  engineCompositionId: string;
  name: string;
  description?: string;
  widgets: unknown[];
  layout: unknown;
  behaviors: unknown;
  inputs: unknown[];
  createdByType?: string;
  createdByRef?: string;
}

/** A new library alert: the composition in the engine's stored JSON shapes. */
export interface NewLibraryAlert {
  name: string;
  description?: string;
  widgetsJson: string;
  layoutJson: string;
  behaviorsJson: string;
  inputsJson?: string;
}

/** What the alert editor frames to preview a composition, and until when it may load it. */
export interface CompositionPreviewUrl {
  url: string;
  /** Epoch ms after which the page refuses the URL's token. */
  expiresAt: number;
}

// ==================== Chat commands ====================

/** A chat command. `actions` and `steps` carry their `$` keys escaped (lib/dollar-keys). */
export interface ChatCommand {
  engineCommandId: string;
  /** Without the `!` prefix. */
  command: string;
  /** The actions the command runs when the engine has not linked it to a workflow yet. */
  actions: unknown[];
  /** The workflow the command runs, by engine id, and its tasks. */
  engineWorkflowId?: string;
  steps?: unknown[];
  /** Why the engine could not give the command its workflow. */
  workflowError?: string;
  /** `{variable}` placeholders read from the text after the command word; absent reads as "". */
  argumentPattern?: string;
  /** Seconds; 0 never throttles. */
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: "public" | "restricted";
  /** `engineGroupId`s of the groups that may run a restricted command. */
  groupIds: string[];
  /** Lowercased usernames granted direct access. */
  usernames: string[];
}

/** A group of users a chat command can be limited to. */
export interface ChatCommandGroup {
  engineGroupId: string;
  name: string;
  description: string;
  /** Seeded by the engine; cannot be renamed or deleted. Absent reads as false. */
  isBuiltIn?: boolean;
  /** ISO time, as the engine reports it. */
  engineCreatedAt: string;
}

interface ChatCommandDefinition {
  command: string;
  enabled: boolean;
  cooldown: number;
  visibility: "public" | "restricted";
  /** `$` keys escaped (lib/dollar-keys). */
  actions?: unknown[];
  /** `$` keys escaped (lib/dollar-keys). */
  steps?: unknown[];
  argumentPattern?: string;
  groupIds?: string[];
  usernames?: string[];
}

export interface NewChatCommand extends ChatCommandDefinition {
  priority?: number;
}

/** A command's full new definition, keyed by `engineCommandId`. */
export interface ChatCommandChanges extends ChatCommandDefinition {
  engineCommandId: string;
  priority: number;
}

export interface NewChatCommandGroup {
  name: string;
  description?: string;
}

export interface ChatCommandGroupChanges {
  engineGroupId: string;
  name: string;
  description?: string;
}

// ==================== Module resources ====================

/** One runtime instance of a module-declared resource kind (a counter, a timer, a queue). */
export interface ModuleResourceInstance {
  /** `{module}:{kind}:{resourceInstanceId}`, the id everything else refers to it by. */
  canonicalId: string;
  /** The engine's own id of the instance. */
  engineInstanceId: string;
  resourceInstanceId: string;
  kind: string;
  moduleId: ModuleId;
  moduleName: string;
  displayName: string;
  /** Values for the kind's `schema` fields. */
  settings?: unknown;
}

/** A resource kind an installed module declares, with the module declaring it. */
export interface DeclaredResourceKind {
  kind: string;
  name: string;
  description: string;
  /** A lucide icon name, when the module chose one. */
  icon?: string;
  schema: unknown[];
  /** Where in an instance's value the reading shown beside its name is; absent means the whole value. */
  summaryPath?: string;
  moduleName: string;
}

/** Every resource value on the instance, keyed by canonical id. */
export type ResourceValues = Record<string, unknown>;

/** A new resource instance; `settings` are values for the kind's `schema` fields. */
export interface NewModuleResourceInstance {
  displayName: string;
  kind: string;
  moduleName: string;
  resourceInstanceId: string;
  settings?: Record<string, unknown>;
}

export interface CreatedModuleResourceInstance {
  canonicalId: string;
  displayName: string;
  /** The engine's id of the new resource instance. */
  instanceId: string;
}

/** A rename and the settings the instance runs with; its identity is fixed. */
export interface ModuleResourceInstanceChanges {
  canonicalId: string;
  displayName: string;
  settings: Record<string, unknown>;
}

// ==================== Modules ====================

export type ManifestSettingAction =
  | { kind: "internal"; request: { event: string; payload?: Record<string, unknown> }; timeoutMs?: number }
  | {
      kind: "integration";
      integration: string;
      /** Whether the manifest declares the integration under `oauth[]`, the only integrations a button can connect. */
      declared: boolean;
    };

/** A module-level setting its manifest declares. */
export interface ManifestSettingField {
  id: string;
  label: string;
  description: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  /** Present only when `type === "button"`. */
  action?: ManifestSettingAction;
  /** Present only when `type === "resource_ref"`: the kind of instance it links. */
  resourceKind?: string;
  /** Present only when `type === "list"`: the fields of one row. */
  itemFields?: ConfigField[];
}

/** A function a module ships. */
export interface ModuleFunctionSummary {
  /** `{moduleId}:function:{manifestId}`; unique within a module. */
  qualifiedName: string;
  name: string;
  file?: string;
  entryPoint?: string;
  runtime?: string;
}

/** A runtime instance type a module's manifest declares. */
export type ManifestResourceKind = Omit<DeclaredResourceKind, "moduleName">;

/** Something on the streamer's network a module reaches (`local[]` in its manifest). */
export interface LocalEndpointSummary {
  id: string;
  name: string;
  protocol: "websocket" | "http";
}

/**
 * Where an installed module came from: shipped with the engine, installed
 * from a marketplace listing, or from an archive someone uploaded.
 */
export type ModuleProvenance = "builtIn" | "marketplace" | "uploaded";

/**
 * How far an installed module has got. Only an engine-confirmed module is
 * `installed`; the others are uploads the dashboard is still handing over, or
 * one that failed.
 */
export type InstalledModuleStatus = "pending" | "delivering" | "installed" | "failed";

/** A module installed on the engine, as the Installed list and the storefront read it. */
export interface InstalledModule {
  id: ModuleId;
  name: string;
  description: string;
  version: string;
  tags: string[];
  author?: string;
  category?: string;
  /** `{manifest id}:{version}:{sha7}`, the key it was installed under; absent until the engine has hashed it. */
  moduleKey?: string;
  status: InstalledModuleStatus;
  /** Null when nothing recorded where it came from. */
  provenance: ModuleProvenance | null;
  /** The marketplace listing and edition it was installed from, when it was. */
  marketplaceListingId?: string;
  marketplaceEdition?: number;
  /** The installed manifest, parsed; null when none is recorded. */
  manifest: Record<string, unknown> | null;
}

/** A module's manifest-derived detail, merged with its marketplace listing when it has one. */
export interface ModuleDetail {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Latest version available in the marketplace, when the module is published there. */
  latestVersion?: string;
  author: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  readme?: string;
  isInstalled: boolean;
  triggers: { key: string; name: string; description: string; color: string }[];
  actions: { key: string; name: string; description: string; color: string }[];
  functions: ModuleFunctionSummary[];
  widgets: { slug: string; name: string }[];
  workflows: { slug: string; name: string }[];
  /** The installed module, only present for installed modules. */
  moduleDbId?: ModuleId;
  manifestSettings: ManifestSettingField[];
  manifestResourceKinds: ManifestResourceKind[];
  /** Permission ids the manifest of `version` declares; null when they could not be read. */
  permissions: string[] | null;
  /** Permission ids `latestVersion` declares, for an installed module with a newer marketplace version. */
  latestPermissions?: string[] | null;
  /** What the manifest of `version` reaches on the streamer's network; null when unreadable. */
  localEndpoints: LocalEndpointSummary[] | null;
  /** `local[]` of `latestVersion`, alongside `latestPermissions`. */
  latestLocalEndpoints?: LocalEndpointSummary[] | null;
}

/** A declared setting's current value. A secret's value never comes back, only whether one is set. */
export interface ModuleSettingValue {
  id: string;
  moduleId: string;
  key: string;
  value: string;
  valueType: string;
  isSet?: boolean;
}

/** A workflow on the engine, as the pickers that list them need it. */
export interface EngineWorkflowOption {
  id: string;
  name: string;
}

/** A zipped module built in the browser, to install on the engine. */
export interface ModuleArchiveInstall {
  archive: Uint8Array;
  /** `{moduleId}:{version}:{first 7 hex of the archive's sha256}`; the install's outcome is reported under it. */
  moduleKey: string;
  /**
   * What the module list shows until the engine reports the install. Read
   * from `manifest`, so they must agree with it; they are passed rather than
   * derived because a manifest without a name falls back to the archive's
   * top-level folder, which only the archive's builder knows.
   */
  name: string;
  description: string;
  version: string;
  tags: string[];
  /** The parsed manifest, kept with the module: the engine's install callback carries none. */
  manifest: Record<string, unknown>;
}

// ==================== Requests ====================

/**
 * A short-lived event recorded from an engine callback under a correlation
 * key, so a caller can follow work the engine does after the request that
 * started it has returned. Events expire after about a minute.
 */
export interface TransientEvent {
  correlationKey: string;
  type: string;
  status: "progress" | "success" | "error";
  message?: string;
  data?: unknown;
  /** Epoch ms. */
  expiresAt: number;
}

/** Which field of which module declaration to ask a module's worker about. */
export interface FieldOptionsReference {
  moduleId: string;
  declaration: "trigger" | "action" | "widget" | "resource" | "setting";
  /** The trigger, action, widget or resource kind; absent for a module setting. */
  declarationId?: string;
  fieldId: string;
}

/** The requests the engine answers with a transient event, and what each one sends. */
export interface CorrelatedRequests {
  /** Asks a module's worker for a field's options, or presses an `internal` settings button. */
  fieldOptions: FieldOptionsReference;
}

export type CorrelatedRequestKind = keyof CorrelatedRequests;

/** A request that could not be sent, so no event will arrive for it. */
export interface CorrelatedFailure {
  correlationKey: string;
  /** What the send rejected with. */
  error: unknown;
}

/**
 * One correlated request at a time: `start` sends it under a fresh key and
 * `event` follows the answer. Starting again replaces the request before, and
 * an answer or failure that arrives late for a replaced request is never read
 * as the current one's.
 */
export interface Correlated<Request> {
  /** The current request's key; null before the first and after `clear`. */
  correlationKey: string | null;
  /** Sends `request` under a new key. Throws when there is no instance to send it to. */
  start: (request: Request) => void;
  /** Drops the current request, so nothing is read for it. */
  clear: () => void;
  /** The latest event for the current request: undefined while loading or with no request, null until one arrives. */
  event: Live<TransientEvent | null>;
  /** The current request's send failure; null when it was sent or there is none. */
  failure: CorrelatedFailure | null;
}

/** The latest transient event under one key, followed outside React. */
export interface EventWatch {
  /** Undefined until the read loads, then the event or null; throws when the read failed. */
  current(): Live<TransientEvent | null>;
  /** Calls `onChange` whenever `current` may have changed; returns the unsubscribe. */
  onUpdate(onChange: () => void): () => void;
}

// ==================== Scenes ====================

/** One overlay scene. `widgets` and `layout` are the engine's stored JSON, parsed. */
export interface SceneRecord {
  /** The gateway's id of the scene, for keys and selection. */
  id: SceneId;
  engineSceneId?: string;
  name: string;
  description?: string;
  widgets: unknown[];
  layout?: unknown;
  sceneWidgets?: unknown[];
  width?: number;
  height?: number;
  backgroundColor?: string;
  /** Epoch ms. */
  createdAt: number;
  updatedAt: number;
}

/** A new scene: its name and, in the engine's stored JSON shapes, its widgets and layout. */
export interface NewScene {
  name: string;
  description?: string;
  widgetsJson?: string;
  layoutJson?: string;
}

/** The parts of a scene to replace; a field left out keeps its value. */
export type SceneChanges = Partial<NewScene>;

/** A widget the instance can place, with the name of the module providing it. */
export interface SceneWidgetCatalogRow {
  widgetId: string;
  name: string;
  description?: string;
  moduleId?: ModuleId;
  moduleName: string;
  directory: string;
  alertTypes: string[];
  settings: unknown[];
  surfaces?: string[];
  hostsSurface?: string;
  taxonomy?: string[];
  projectionKey?: string;
  createdByType?: string;
  createdByRef?: string;
  behaviorKinds?: {
    transitions: { id: string; label: string }[];
    effects: { id: string; label: string }[];
  };
}

/** One Alert step, in a workflow or a chat command, and the alert widget name it plays on. */
export interface AlertTargetUse {
  target: string;
  kind: "workflow" | "command";
  /** The workflow's name, or the command as typed in chat ("!hype"). */
  name: string;
}

/**
 * What one scene's editor needs to warn that an edit leaves Alert steps with
 * no alert widget to play on.
 */
export interface AlertTargetUsage {
  /** The canonical ids of the widgets that host alerts, so the editor can tell its own alert widgets apart. */
  alertWidgetIds: string[];
  /** Names the alert widgets of every scene but the one asked about answer to. */
  elsewhere: string[];
  /** Every Alert step's target, in workflows and chat commands. */
  uses: AlertTargetUse[];
}

// ==================== Workflows ====================

/** A workflow on the engine. `definition` and `nodes` carry their `$` keys escaped (lib/dollar-keys). */
export interface Workflow {
  engineWorkflowId: string;
  definition: unknown;
  isEnabled: boolean;
  /** The builder's nodes and edges. */
  nodes?: unknown[];
  edges?: unknown[];
  projectionKey?: string;
  projectionUpdatedAt?: number;
  /** Epoch ms. */
  createdAt: number;
  updatedAt: number;
}

/**
 * What the UI's workflow logic reads of a workflow. Structural, so the pure
 * libraries work on any gateway's rows; a read returns the whole record,
 * which has these.
 */
export type WorkflowRecord = Pick<Workflow, "engineWorkflowId" | "definition" | "isEnabled" | "nodes">;

/** A trigger an installed module registers, as the builder offers it. */
export interface WorkflowCatalogTrigger {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  event: string | undefined;
  allowVariants: boolean | undefined;
  configFields: unknown[] | undefined;
  emits: unknown[] | undefined;
  sentence: string | undefined;
  summary: string | undefined;
  summaryDetails: string[] | undefined;
  projectionKey: string | undefined;
  taxonomy: string[] | undefined;
  transport: string | undefined;
  canonicalRef: string | undefined;
  moduleId: ModuleId | undefined;
  moduleName: string | undefined;
  moduleLabel: string;
}

/** An action an installed module registers, as the builder offers it. */
export interface WorkflowCatalogAction {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  configFields: unknown[] | undefined;
  returns: unknown[] | undefined;
  sentence: string | undefined;
  projectionKey: string | undefined;
  taxonomy: string[] | undefined;
  canonicalRef: string | undefined;
  handlerType: string | undefined;
  functionCall: string | undefined;
  moduleId: ModuleId | undefined;
  moduleName: string | undefined;
  moduleLabel: string;
}

/** The workflow builder's catalog: the triggers and actions the installed modules register. */
export interface WorkflowCatalog {
  triggers: WorkflowCatalogTrigger[];
  actions: WorkflowCatalogAction[];
}

/** Who started a run, which the run history and the replay controls tell apart. */
/** A workflow run as the engine pushes it while it happens. */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  completedAt?: Date;
  triggeredBy?: string;
  error?: string;
  /** How far through its steps the run is, 0 to 100, when the engine reports it. */
  progress?: number;
}

export type WorkflowRunOrigin = "dashboard" | "test" | "replay";

/** A manual run: the workflow by name or id, its parameters, and test-run options. */
export interface WorkflowTrigger {
  workflowNameOrId: string;
  parameters?: Record<string, string>;
  origin?: WorkflowRunOrigin;
  options?: {
    platform?: string;
    dryRun?: boolean;
    triggerData?: Record<string, unknown>;
    skipConditions?: boolean;
  };
}

/** A trigger condition a test run's event did not meet. */
export interface UnmetTriggerCondition {
  field: string;
  operator: string;
  value: unknown;
  /** Set when the condition could not be evaluated. */
  error?: string;
}

/** How the engine answered a manual run; its progress arrives in transient events under `triggerId`. */
export interface WorkflowTriggerResult {
  triggerId: string;
  /** `requested`, `started`, or `conditions_not_met`. */
  status: string;
  executionId: string | null;
  unmetConditions: UnmetTriggerCondition[];
  dryRun: boolean;
}

/** A recorded run to run again, whole or from one step. */
export interface WorkflowReplay {
  engineRunId: string;
  fromTaskId?: string;
  origin?: WorkflowRunOrigin;
}

/** How stopping a run went: the engine's outcome, or `marked` when an older engine only marked it stopped. */
export interface WorkflowCancelResult {
  outcome: "cancelled" | "already_finished" | "marked";
  status: string;
}

/** A recorded run. Engine times are ISO strings; `createdAt` is epoch ms. */
export interface WorkflowRunRecord {
  engineRunId: string;
  workflowId: string;
  workflowName: string | undefined;
  status: string;
  triggeredBy?: string;
  /** The triggering event's JSON. */
  triggerEvent?: string;
  dryRun?: boolean;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  engineCreatedAt: string;
  engineUpdatedAt: string;
}

/** One recorded attempt at a step of a run. Engine times are ISO strings; `createdAt` is epoch ms. */
export interface WorkflowRunStep {
  engineStepId: string;
  runId: string;
  taskId: string;
  stepIndex: number;
  attempt: number;
  name?: string;
  status: string;
  /** The step's inputs and outputs as JSON. */
  inputs?: string;
  outputs?: string;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  engineCreatedAt: string;
  engineUpdatedAt: string;
}

/** An alert a recorded run played. */
export interface WorkflowRunAlert {
  engineAlertId: string;
  status: EngineAlertStatus;
  payload: string | undefined;
  error: string | undefined;
  dispatchedAt: string | undefined;
  playedAt: string | undefined;
  completedAt: string | undefined;
  engineCreatedAt: string | undefined;
  unconfirmedAt: number | undefined;
}

/** A recorded run with its steps and the alerts it played; null when it is not recorded or not the caller's. */
export type WorkflowRunDetail = {
  run: WorkflowRunRecord;
  steps: WorkflowRunStep[];
  alerts: WorkflowRunAlert[];
} | null;

/** One recorded run of a workflow, as its run history lists it. */
export interface RecordedWorkflowRun {
  engineRunId: string;
  status: string;
  triggeredBy: string | undefined;
  error: string | undefined;
  startedAt: string | undefined;
  completedAt: string | undefined;
  hasTriggerEvent: boolean;
  dryRun: boolean;
}

/** An enabled workflow the engine reported it could not set up. */
export interface NotRunningWorkflow {
  engineWorkflowId: string;
  reason: string | null;
  /** ISO time. */
  since: string;
}

/** What prompted a workflow health resync; repeats are throttled per instance. */
export type WorkflowHealthResyncTrigger = "mount" | "reconnect";

export type WorkflowHealthResyncResult = "ok" | "skipped" | "failed" | "unsupported" | "loading";

// ==================== Macros ====================

/** The value given for one of a macro's variables. */
export interface MacroVariableValue {
  name: string;
  value: string;
}

/** The key of the workflow run a macro started, or null when it started none. */
export interface MacroRunResult {
  triggerId: string | null;
}

// ==================== Stream operations ====================

/** Why an engine call a recap or refresh needs did not answer. */
export type EngineCallFailure =
  | { status: "rejected" }
  | { status: "unreachable"; message: string }
  | { status: "failed"; message: string };

export interface RecapViewerSample {
  /** ISO time. */
  sampledAt: string;
  viewerCount: number | null;
}

/** A recapped session's per-minute viewer samples and top supporters, or why they could not be read. */
export type StreamRecapEngineDetail =
  | {
      status: "ok";
      viewerSamples: RecapViewerSample[];
      topCheerers: Supporter[];
      topGifters: Supporter[];
    }
  | { status: "unregistered" }
  | { status: "unknown_session" }
  | EngineCallFailure;

export type RecapEventKind = "follow" | "sub" | "giftedSubs" | "cheer" | "raid";

export interface RecapEvent {
  /** ISO time. */
  occurredAt: string;
  kind: RecapEventKind;
  userName: string | null;
  amount: number | null;
}

/** A session's counted events; `total` counts every event the engine has, so the page can say how many it left out. */
export type RecapTimelineEvents =
  | { status: "ok"; events: RecapEvent[]; total: number }
  | { status: "unregistered" }
  | { status: "unknown_session" }
  | EngineCallFailure;

export interface StreamRecapSegment {
  id: string;
  /** ISO time the stream went live. */
  startedAt: string;
  /** ISO time the stream went down; null while it was still live when the figures were taken. */
  endedAt: string | null;
}

export interface StreamRecapSession {
  /** `open` until the engine closes the session, which outlasts a brief offline gap; not the same as live. */
  status: "open" | "closed";
  /** ISO time. */
  startedAt: string;
  /** ISO time a later session replaced this one; null while open. */
  endedAt: string | null;
  /** Oldest first; empty for a session that never went live. */
  segments: StreamRecapSegment[];
}

/**
 * A session's channel totals. `subs` leaves out gifted subs, which are only
 * in `giftedSubs`, so the two add up. A null viewer figure means no minute
 * was sampled, not zero viewers.
 */
export interface StreamRecapTotals {
  bits: number;
  cheers: number;
  subs: number;
  giftedSubs: number;
  follows: number;
  raids: number;
  raiders: number;
  peakViewers: number | null;
  averageViewers: number | null;
  viewerSampleMinutes: number;
}

/** A recap's session and totals, or the schema version of a summary from an engine newer than this dashboard. */
export type StreamRecapSummary =
  | { kind: "read"; session: StreamRecapSession; totals: StreamRecapTotals }
  | { kind: "unreadable"; schemaVersion: number };

/** How one stream session went, as of `generatedAt`: the moment its figures describe. */
export interface StreamRecap {
  sessionId: string;
  /** ISO time. */
  generatedAt: string;
  generatedAtMs: number;
  /** True only while the session's stream is live now. */
  inProgress: boolean;
  summary: StreamRecapSummary;
}

/** A Twitch clip made while a recapped session was live. */
export interface RecapClip {
  id: string;
  url: string;
  title: string;
  creatorName: string;
  viewCount: number;
  /** ISO time. */
  createdAt: string;
  thumbnailUrl: string;
  durationSeconds: number;
  /** Milliseconds into the stream; never negative. */
  offsetMs: number;
}

/** A recap's clips, most viewed first. */
export type RecapClips = { status: "ok"; clips: RecapClip[] } | { status: "never_live" };

/** A stream marker placed while a recapped session was live. */
export interface RecapMarker {
  id: string;
  /** ISO time. */
  createdAt: string;
  description: string;
}

/**
 * A recap's markers. Twitch keeps markers on a broadcast's VOD, so a stream
 * with none (`no_vod`) has no markers to read, and a Twitch link without a
 * marker scope (`missing_scope`) cannot read them.
 */
export type RecapMarkers =
  | { status: "ok"; markers: RecapMarker[] }
  | { status: "never_live" }
  | { status: "missing_scope" }
  | { status: "no_vod" };

/** Whether the open session's summary was stored, was fresh already, or could not be. */
export type OpenSessionRefresh =
  | { status: "stored" }
  | { status: "fresh" }
  | { status: "no_open_session" }
  | { status: "unregistered" }
  | EngineCallFailure;

/** A stream the engine recorded. Times are ISO strings. */
export interface SupporterStream {
  id: string;
  status: "open" | "closed";
  startedAt: string;
  endedAt: string | null;
  segments: { startedAt: string; endedAt: string | null }[];
}

/** A viewer's support in one metric: the amount (`total`) and the events behind it. */
export interface Supporter {
  platformUserId: string;
  userName: string | null;
  total: number;
  events: number;
}

/** Which supporters to rank: by bits or gifted subs, for one stream (`sessionId`) or all time, at or above `minTotal`. */
export interface SupporterLeaderboardQuery {
  metric: "bits" | "giftedSubs";
  sessionId?: string;
  minTotal: number;
}

/** What one viewer gave: `bits` and `giftedSubs` are the amounts, `cheers` and `gifts` the events behind them. */
export interface SupporterTotals {
  bits: number;
  cheers: number;
  giftedSubs: number;
  gifts: number;
}

/** One viewer's lifetime support and their support in each of the last few live streams. */
export interface ViewerSupportTotals {
  userName: string | null;
  lifetime: SupporterTotals;
  recent: { stream: SupporterStream; totals: SupporterTotals }[];
}

/**
 * An event to publish on the engine's bus. `triggerId` is the key the runs it
 * starts report under; `triggeredBy` tags those runs.
 */
export interface EngineTestEvent {
  eventType: string;
  eventData: unknown;
  triggerId?: string;
  triggeredBy?: string;
}

/** Whether the engine published the event; `message` says why not. */
export interface PublishedTestEvent {
  success: boolean;
  message: string;
}

// ==================== Configuration ====================

/** The parts of a configuration a backup can carry. */
export type ConfigSection = "workflows" | "commands" | "groups" | "resources";

export type ConfigConflictPolicy = "skip" | "rename" | "overwrite";

/** Which sections to back up, and whether to include each group's members. */
export interface ConfigExportRequest {
  include: ConfigSection[];
  includeMembers: boolean;
}

/** A backup, as the chunks it was read into, and how to apply it. */
export interface ConfigImportRequest {
  bundleChunks: string[];
  include: ConfigSection[];
  onConflict: ConfigConflictPolicy;
  applyMembers: boolean;
}

export type ConfigItemKind = "workflow" | "command" | "group" | "resource";

export type ConfigImportAction = "create" | "update" | "skip" | "conflict";

export type ConfigImportReasonCode =
  | "identical"
  | "name_collision"
  | "renamed"
  | "overwrite"
  | "not_owned"
  | "missing_module"
  | "module_version_mismatch"
  | "unknown_resource_kind"
  | "unknown_action"
  | "unknown_group"
  | "unknown_workflow"
  | "dependency_blocked"
  | "invalid"
  | "rename_exhausted"
  | "grants_access"
  | "members_not_applied"
  | "privileged_action";

export interface ConfigImportReason {
  code: ConfigImportReasonCode;
  message: string;
  /** True when this reason alone keeps the item from being applied. */
  blocking: boolean;
}

export interface ConfigImportPlanItem {
  kind: ConfigItemKind;
  /** The item's identity in the backup: name, command word, or canonical id. */
  key: string;
  action: ConfigImportAction;
  /** The name it will have on this engine; differs from `key` when renamed. */
  targetName: string;
  /** The existing item it matches, for `update` and `skip`. */
  targetId?: string;
  reasons: ConfigImportReason[];
}

/** What importing a backup would do, without doing it. */
export interface ConfigImportPlan {
  onConflict: ConfigConflictPolicy;
  items: ConfigImportPlanItem[];
  summary: Record<ConfigImportAction, number>;
  /** Modules the backup requires that the engine does not have installed. */
  missingModules: { moduleId: string; version: string }[];
}

export type ConfigImportOutcome = "created" | "updated" | "skipped" | "conflict" | "failed";

export interface ConfigImportResultItem {
  kind: ConfigItemKind;
  key: string;
  action: ConfigImportAction;
  outcome: ConfigImportOutcome;
  name?: string;
  id?: string;
  /** Why it failed or conflicted. */
  error?: string;
}

export interface ConfigImportResult {
  items: ConfigImportResultItem[];
  summary: Record<ConfigImportOutcome, number>;
}

// ==================== Twitch link ====================

/** The Twitch account the instance acts as on Twitch. */
export interface TwitchLink {
  platformUserId: string;
  platformUsername: string;
  profileImageUrl: string | undefined;
  /** The scopes Twitch granted when the account was linked. */
  scopes: string[];
  /** When Twitch last refused the link's token (epoch ms); undefined while Twitch accepts it. */
  authFailedAt: number | undefined;
  /** Whether the viewer may replace or remove the link (an owner or admin). */
  viewerCanRelink: boolean;
}

/**
 * How an attempt to link Twitch stands. A gateway either sends the browser to
 * Twitch to approve (`redirecting`: the page is about to leave, and the link
 * shows up when it comes back), or has the streamer approve on any device
 * with a code (`awaitingApproval`: the link shows up through `useLink` once
 * they have).
 */
export type TwitchLinking =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "redirecting" }
  | {
      status: "awaitingApproval";
      /** The code the streamer types at `verificationUri`. */
      userCode: string;
      verificationUri: string;
      /** When the code stops working, in epoch ms. */
      expiresAt: number;
    }
  | { status: "failed"; error: string };

export interface TwitchLinkStart {
  /** The app path to come back to, for a gateway that leaves the page for Twitch. */
  returnTo: string;
}

/** Linking Twitch, for one component: what the attempt is doing and how to start or abandon one. */
export interface TwitchLinkFlow {
  linking: TwitchLinking;
  /** Starts linking, replacing the account already linked. */
  start: (request: TwitchLinkStart) => void;
  /** Abandons the attempt under way and returns to `idle`. */
  cancel: () => void;
}

// ==================== Module OAuth ====================

/** Connecting one of an installed module's declared OAuth integrations. */
export interface ModuleOAuthConnect {
  /** What the module detail was asked for with: an installed module's key or a marketplace id. */
  moduleId: string;
  /** The integration's id in the module's manifest. */
  integration: string;
  /** The app path the provider sends the browser back to. */
  returnTo: string;
}

/**
 * How finishing a connect went. `error` is an OAuth error code, which
 * lib/oauthErrors words for the streamer.
 */
export type ModuleOAuthFinish = { ok: true; integration: string } | { ok: false; error: string };

// ==================== Setup imports ====================

export type SetupImportSource = "firebot" | "streamerbot";

/**
 * - `review`: read and waiting for the streamer to look it over; nothing is on the engine yet.
 * - `queued`, `applying`: its items are being created on the engine.
 * - `done`: every item has an outcome.
 */
export type SetupImportStatus = "review" | "queued" | "applying" | "done";

export type SetupImportItemKind = "group" | "counter" | "command" | "workflow";

/** Whether an item comes over as it was (`ready`), with changes (`partial`), or not at all. */
export type SetupImportReadiness = "ready" | "partial" | "unsupported";

export type SetupImportOutcome = "created" | "exists" | "needs_module" | "skipped" | "pending" | "failed";

export interface SetupImportNote {
  message: string;
  detail?: string;
  /** Set when the note is why the item cannot come over. */
  blocking?: boolean;
}

/** Something in the export that is not an item and does not come over, with why. */
export interface SetupImportLeftover {
  origin: string;
  name: string;
  message: string;
  detail?: string;
}

/** One engine object an import creates, and how creating it went. */
export interface SetupImportItem {
  id: string;
  kind: SetupImportItemKind;
  name: string;
  /** Where it came from in the other bot, as the streamer would find it there. */
  origin: string;
  readiness: SetupImportReadiness;
  notes: SetupImportNote[];
  /** What it does, step by step. */
  steps: string[];
  outcome: SetupImportOutcome | null;
  message: string | null;
}

export interface SetupImportReport {
  id: SetupImportId;
  source: SetupImportSource;
  label: string;
  status: SetupImportStatus;
  createdAt: number;
  /** Why a queued import has not started; null when it is not waiting. */
  waitingFor: string | null;
  /** Gave up waiting on something outside the import; retrying starts it once that is fixed. */
  stalled: boolean;
  leftovers: SetupImportLeftover[];
  items: SetupImportItem[];
}

/** An export to read for review: the decoded document's JSON text, in chunks to join. */
export interface SetupImportAnalysis {
  source: SetupImportSource;
  documentChunks: string[];
}

// ==================== Marketplace catalog ====================

/** The catalog as the marketplace serves it, parsed in shared code by every gateway. */
export type {
  AuthorPage,
  CatalogCounts,
  CatalogListing,
  CatalogListingDetail,
  CatalogPage,
  ListingQuote,
  ListingType,
} from "@shared/marketplace-catalog";

/** The orders the marketplace can return a page in. */
export type MarketplaceSort = "relevance" | "newest" | "name" | "popular" | "trending";

/** One search of the catalog. An empty `query` or `types` narrows nothing. */
export interface MarketplaceSearchQuery {
  query: string;
  types: ListingType[];
  category?: string;
  /** Only curated listings, in `featuredRank` order. */
  featured?: boolean;
  sort: MarketplaceSort;
  limit?: number;
  offset?: number;
}

/** One page of a list the marketplace pages itself. */
export interface MarketplacePageRequest {
  limit: number;
  offset: number;
}

/** What starting a purchase came to. */
export type MarketplaceCheckout =
  /** Pay on the marketplace's payment page at `url`. */
  | { status: "redirect"; url: string }
  /** The account already holds the listing. */
  | { status: "already_entitled" }
  /** Nothing to pay, such as a free upgrade. */
  | { status: "no_payment_needed" }
  /** Nothing can be bought here; `message` says why. */
  | { status: "unavailable"; message: string };

// ==================== Marketplace installs and starter packs ====================

/** What installing a marketplace bundle (a scene or an alert) made on the engine. */
export interface MarketplaceBundleInstall {
  kind: "scene" | "alert";
  /** The engine's id for the scene or alert composition it made. */
  engineId: string;
}

/** Whether a starter-pack item is in place on the engine. */
export type StarterPackItemState = "installed" | "installing" | "conflict" | "available";

/** How installing one starter-pack item went. */
export interface StarterPackInstallOutcome {
  itemId: string;
  outcome: "installed" | "already-installed" | "pending" | "conflict" | "busy" | "unavailable" | "failed";
  message?: string;
}

/** A starter pack to install, with the values the streamer filled in for its fields. */
export interface StarterPackInstall {
  packId: string;
  values: Record<string, string | number>;
}

// ==================== Twitch channel ====================
// What the dashboard does on the linked Twitch channel, as the broadcaster.
// The engine makes these calls itself (its `twitch.*` capabilities) and
// answers with Twitch's own bodies; a gateway parses them into these.
// A value these records lack (Twitch left it out, or nothing was kept) is
// null, never undefined; an absent field means "leave it as it is" and only
// appears in what a request takes (`ChatSettingsPatch`, `StreamInfoChanges`).

/**
 * The channel's ad schedule. Times are ISO-8601 strings, null when Twitch
 * reported none, and are read against `serverNow`, the gateway's clock when
 * Twitch answered.
 */
export interface AdSchedule {
  /** When the next scheduled mid-roll starts; null when none is scheduled. */
  nextAdAt: string | null;
  /** When the last ad break started. */
  lastAdAt: string | null;
  /** Length of the next scheduled ad break. */
  durationSeconds: number;
  /** Preroll-free time left at the moment Twitch answered. */
  prerollFreeSeconds: number;
  /** Snoozes left to spend. */
  snoozeCount: number;
  /** When the next snooze is added back; null when the count is full. */
  snoozeRefreshAt: string | null;
  serverNow: string;
}

/** The schedule after a snooze, read against `serverNow` like `AdSchedule`. */
export interface AdSnoozeResult {
  snoozeCount: number;
  snoozeRefreshAt: string | null;
  nextAdAt: string | null;
  serverNow: string;
}

/** A moderation action the widget offers, each with its own role rule and Twitch scope. */
export type ModerationCapability = "addBlockedTerm" | "removeBlockedTerm" | "timeout" | "ban" | "chatSettings";

/**
 * Whether the caller can use a capability now: `not-linked` (no Twitch link),
 * `not-allowed` (their role may not), `needs-reconnect` (the link lacks the
 * scope) or `ready`.
 */
export type ModerationCapabilityStatus = "ready" | "not-linked" | "not-allowed" | "needs-reconnect";

export type ModerationAccess = Record<ModerationCapability, ModerationCapabilityStatus>;

/** A term Twitch's AutoMod holds back in the channel's chat. Times are ISO-8601; null when Twitch sent none. */
export interface BlockedTerm {
  id: string;
  text: string;
  createdAt: string | null;
  expiresAt: string | null;
}

export interface BlockedTermList {
  terms: BlockedTerm[];
  /** True when the channel has more terms than one read returns. */
  truncated: boolean;
}

/** The viewer a timeout, ban or unban was applied to. */
export interface ModeratedUser {
  login: string;
  displayName: string;
}

/** The channel's chat modes. */
export interface ChatSettings {
  emoteMode: boolean;
  followerMode: boolean;
  /** Minutes an account must have followed; null while follower mode is off. */
  followerModeDuration: number | null;
  slowMode: boolean;
  /** Seconds between messages; null while slow mode is off. */
  slowModeWaitTime: number | null;
  subscriberMode: boolean;
}

/** The chat modes to change; an absent field is left as it is. */
export interface ChatSettingsPatch {
  emoteMode?: boolean;
  followerMode?: boolean;
  followerModeDuration?: number;
  slowMode?: boolean;
  slowModeWaitTime?: number;
  subscriberMode?: boolean;
}

/** What Twitch has pinned in chat now. Twitch reports no text for some pins. */
export interface CurrentPin {
  messageId: string;
  content: string | null;
  authorName: string | null;
  /** ISO-8601; null when the pin lasts until the stream ends. */
  expiresAt: string | null;
}

/** A message worth pinning again, kept across streams. Times are epoch ms. */
export interface PinHistoryEntry {
  id: PinHistoryEntryId;
  content: string;
  authorName: string | null;
  /** The chat message's id on Twitch; null for an entry this app never posted. */
  twitchMessageId: string | null;
  createdAt: number;
  lastPinnedAt: number | null;
}

export interface PinnedMessage {
  messageId: string;
}

export interface RepinnedMessage {
  messageId: string;
  /** True when the original message could no longer be pinned, so its text was posted again and pinned. */
  resent: boolean;
}

/** Someone in the channel's chat right now. */
export interface Chatter {
  userId: string;
  login: string;
  displayName: string;
}

/** A Twitch channel, as a shoutout confirms it. */
export interface TwitchChannel {
  twitchUserId: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
  /** `partner`, `affiliate`, or empty for neither. */
  broadcasterType: string | null;
}

/** Whom to look up on Twitch: by login as a person types it (`@SomeOne`), or by user id. */
export type TwitchViewerLookup = { login: string } | { twitchUserId: string };

/** A channel waiting to be shouted out; the queue paces shoutouts within Twitch's limits. Times are epoch ms. */
export interface ShoutoutEntry {
  id: ShoutoutEntryId;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
  broadcasterType: string | null;
  attempts: number;
  /** Not tried again before this. */
  nextEligibleAt: number;
  lastError: string | null;
}

/** Twitch's announcement colors; there is no free-form one. */
export type AnnouncementColor = "primary" | "blue" | "green" | "orange" | "purple";

export interface Announcement {
  message: string;
  color: AnnouncementColor;
}

/** A clip made from the live stream. It stays a draft until trimmed and published at `editUrl`. */
export interface CreatedClip {
  clipId: string;
  editUrl: string;
}

export interface StreamCategory {
  id: string;
  name: string;
  /** Sized box art URL; null when Twitch has none for the category. */
  boxArtUrl: string | null;
}

/** The channel's title, category and tags. */
export interface StreamInfo {
  title: string;
  /** Null when the channel has no category set. */
  category: StreamCategory | null;
  tags: string[];
}

export type StreamInfoField = "title" | "category" | "tags";

/** Some of a channel's fields; an absent field is left as it is and `category: null` clears it. */
export type StreamInfoChanges = Partial<StreamInfo>;

/** Box art the caller already shows for a category, reused while the category is unchanged. */
export interface KnownBoxArt {
  categoryId: string;
  boxArtUrl: string;
}

export interface StreamInfoUpdate {
  /** The channel as Twitch holds it after the change. */
  info: StreamInfo;
  /** Requested fields Twitch did not take; it answers success even when it ignores a value. */
  unapplied: StreamInfoField[];
}

/** A marker on the live stream's VOD. Null fields are ones Twitch did not report. */
export interface StreamMarker {
  positionSeconds: number | null;
  /** ISO-8601. */
  createdAt: string | null;
}

/** A named title, category and tags to apply in one go. */
export interface StreamInfoPreset {
  id: StreamInfoPresetId;
  name: string;
  info: StreamInfo;
}

export interface NewStreamInfoPreset {
  /** Saving under a name a preset already has replaces that preset. */
  name: string;
  info: StreamInfo;
}

// ==================== Go live ====================

/** Every check the go-live checklist runs. Dismissals are kept by these ids. */
export type GoLiveCheckId = "engine" | "twitch" | "overlays" | "obs" | "stream-info" | "workflows";

/** The channel as it stood when the checklist was last completed. Epoch ms. */
export interface LastGoLive {
  completedAt: number;
  title: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

export interface GoLiveWorkflowFacts {
  /** Whether the instance has any workflow at all, enabled or not. */
  any: boolean;
  /** Enabled workflows, counted up to a cap. */
  enabled: number;
  /** True when there are more enabled workflows than `enabled` says. */
  enabledCapped: boolean;
}

/** What the checklist keeps between runs, and the workflow facts it checks. */
export interface GoLiveChecklistState {
  dismissedCheckIds: GoLiveCheckId[];
  lastGoLive: LastGoLive | null;
  /** A "Stream start" marker is waiting for the stream to go live. */
  markerPending: boolean;
  workflows: GoLiveWorkflowFacts;
}

export interface GoLiveOverlayFacts {
  hasScene: boolean;
  /** Browser-source keys meant for OBS; the scene editor's preview keys are not counted. */
  browserSourceKeyCount: number;
  /** The key most recently loaded by a browser source, else the newest one. */
  featuredKey: string | null;
  /** When any browser source last loaded one of those keys, in epoch ms. */
  lastLoadedAt: number | null;
}

export type GoLiveTwitchFacts =
  | { linked: false }
  | {
      linked: true;
      login: string;
      /** False when Twitch refused the token and it could not be refreshed. */
      tokenValid: boolean;
      tokenProblem: string | null;
      /** Scopes of required Twitch capabilities the link was never granted. */
      missingScopes: string[];
    };

export type GoLiveStreamInfoFacts =
  | { kind: "unlinked" }
  | {
      kind: "ok";
      login: string;
      title: string;
      categoryId: string;
      categoryName: string;
      tags: string[];
    };

export interface GoLiveFinish {
  /** Posted to chat as the broadcaster when present. */
  announcement?: string;
  /** Dropped now when live, else when the stream next goes live. */
  dropMarker: boolean;
}

export type GoLiveStepOutcome =
  | { status: "done" }
  /** Waiting on something outside the request, such as the stream going live. */
  | { status: "queued"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; message: string };

export interface GoLiveCompletion {
  announcement: GoLiveStepOutcome;
  marker: GoLiveStepOutcome;
}

// ==================== Dashboard ====================

// The layout's types are shared with Convex, which edits layouts with the
// same operations (shared/dashboard-layout.ts).
export type { DashboardPanel, DashboardPanelWidget, DashboardRailWidget } from "@shared/dashboard-layout";

/** The dashboard's notes: one scratch pad per instance, shared by everyone on it. */
export interface DashboardNote {
  content: string;
  /** Epoch ms of the last save. */
  updatedAt: number;
  /** Who saved last; null when that user is gone, or where there are no users to tell apart. */
  updatedByName: string | null;
  /** Whether the viewer saved last, so the widget can leave out "edited by you". */
  updatedByMe: boolean;
}

/** An event row kept from the Events tab, as it read when it was saved. */
export interface StreamHighlight {
  id: StreamHighlightId;
  /** The event's type, or a short platform kind such as `follow` on older highlights. */
  kind: string;
  userName: string;
  detail: string | null;
  amount: number | null;
  /** Epoch ms the event happened. */
  occurredAt: number;
}

export interface NewStreamHighlight {
  kind: string;
  /** Trimmed; a blank name is refused. */
  userName: string;
  detail?: string;
  amount?: number;
  /** Epoch ms. */
  occurredAt: number;
}
