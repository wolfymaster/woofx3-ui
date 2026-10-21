import type { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { FieldOptionsReference } from "@convex/lib/fieldOptions";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

export type { CompositionPreviewUrl } from "@convex/compositionPreview";
export type { AlertClearResult, AlertReplayResult, AlertSkipResult } from "@convex/lib/alertQueueResults";
export type { ConfigImportPlan, ConfigImportResult } from "@convex/lib/configBundle";
export type { EngineCapability, EngineCapabilityReport } from "@convex/lib/engineCapabilities";
export type { ObsStatus } from "@convex/lib/engineObsStatus";
export type { FieldOptionsReference } from "@convex/lib/fieldOptions";
export type { SceneEditorSession as SceneEditorGrant } from "@convex/lib/sceneEditorSession";
export type { RecapTimelineEvents, StreamRecapEngineDetail } from "@convex/lib/streamRecap";
export type { Supporter, SupporterStream } from "@convex/lib/supporters";
export type { WidgetThemes } from "@convex/lib/widgetThemes";
export type { ModuleDetailResult as ModuleDetail } from "@convex/moduleDetail";
export type { ModuleSettingValue } from "@convex/moduleSettingsActions";
export type {
  HostedStorageUsage,
  PaginatedResourcesDto as ResourcePage,
  ResourceDto as Resource,
} from "@convex/resources";
export type { AlertTargetUsage, SceneWidgetCatalogRow } from "@convex/sceneWidgets";
export type { OpenSessionRefresh } from "@convex/streamRecap";
export type { NotRunningWorkflow } from "@convex/workflowHealth";
export type {
  EngineInfo,
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  ModuleFileContent,
  ModuleFileList,
  SceneRepairResult,
  StorageConfig,
  StreamEventFrame,
  UploadGrant,
} from "@woofx3/api";
export type { WorkflowRun } from "@/lib/transport";

/** The Convex `_id` of the instance record, which is the instance's only identity. */
export type InstanceId = Id<"instances">;

/**
 * A subscribed read, shaped like Convex's `useQuery`: `undefined` while
 * loading, the value once known, and a thrown error on failure.
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
 * A paged subscribed read, shaped like Convex's `usePaginatedQuery`: `results`
 * grows as `loadMore` brings in pages, and every loaded page stays live.
 */
export interface Paginated<T> {
  results: T[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  isLoading: boolean;
  loadMore: (numItems: number) => void;
}

/** Which instance engine hooks read, owned by `EngineGatewayProvider`. */
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

// Records the engine mirrors into Convex keep their Convex fields (`_id`,
// `_creationTime`): callers use them for keys and ordering, and a gateway
// that reads the engine directly has to supply them too.

/** One alert the engine dispatched, kept current by its `alert.*` callbacks. */
export type EngineAlert = Doc<"engineAlerts">;

/** How alerts have gone over a window: totals by outcome and one bucket per hour. */
export type AlertOverview = NonNullable<FunctionReturnType<typeof api.engineAlerts.overview>>;

/** One alert in the engine's library, cached from its webhooks. */
export type AlertComposition = Doc<"alertCompositions">;

/** A new library alert: the composition in the engine's stored JSON shapes. */
export interface NewLibraryAlert {
  name: string;
  description?: string;
  widgetsJson: string;
  layoutJson: string;
  behaviorsJson: string;
  inputsJson?: string;
}

/** A chat command, mirrored from the engine's webhooks. */
export type ChatCommand = Doc<"chatCommands">;

/** A group of users a chat command can be limited to, mirrored from the engine's webhooks. */
export type ChatCommandGroup = Doc<"chatCommandGroups">;

export type NewChatCommand = Omit<FunctionArgs<typeof api.chatCommandActions.createCommand>, "instanceId">;

/** A command's full new definition, keyed by `engineCommandId`. */
export type ChatCommandChanges = Omit<FunctionArgs<typeof api.chatCommandActions.updateCommand>, "instanceId">;

export type NewChatCommandGroup = Omit<FunctionArgs<typeof api.chatCommandActions.createGroup>, "instanceId">;

export type ChatCommandGroupChanges = Omit<FunctionArgs<typeof api.chatCommandActions.updateGroup>, "instanceId">;

/** One runtime instance of a module-declared resource kind (a counter, a timer, a queue), mirrored from the engine's webhooks. */
export type ModuleResourceInstance = Doc<"moduleResourceInstances">;

/** The installed module that provides a resource kind, merged with the kind's declaration. */
export type ResourceKindDefinition = NonNullable<FunctionReturnType<typeof api.resourceKinds.getForInstance>>;

/** A resource kind an installed module declares, with the module declaring it. */
export type DeclaredResourceKind = FunctionReturnType<typeof api.resourceKinds.listForInstance>[number];

/** Every mirrored resource value on the instance, keyed by canonical id. */
export type ResourceValues = FunctionReturnType<typeof api.resourceValues.listForInstance>;

/** A new resource instance; `settings` are values for the kind's `schema` fields. */
export type NewModuleResourceInstance = Omit<
  FunctionArgs<typeof api.moduleResourceActions.createResourceInstance>,
  "instanceId"
>;

export type CreatedModuleResourceInstance = FunctionReturnType<typeof api.moduleResourceActions.createResourceInstance>;

/** A rename and the settings the instance runs with; its identity is fixed. */
export type ModuleResourceInstanceChanges = Omit<
  FunctionArgs<typeof api.moduleResourceActions.updateResourceInstance>,
  "instanceId"
>;

/** The Convex id of an installed module's repository row. */
export type ModuleId = Id<"moduleRepository">;

/** The Convex id of a dashboard macro. Macros are kept in Convex; only running one reaches the engine. */
export type MacroId = Id<"macros">;

/** The value given for one of a macro's variables. */
export type MacroVariableValue = FunctionArgs<typeof api.macros.run>["values"][number];

/** The key of the workflow run a macro started, or null when it started none. */
export type MacroRunResult = FunctionReturnType<typeof api.macros.run>;

/** Which supporters to rank: by bits or gifted subs, for one stream (`sessionId`) or all time, at or above `minTotal`. */
export type SupporterLeaderboardQuery = Omit<FunctionArgs<typeof api.supporters.leaderboard>, "instanceId">;

/** One viewer's lifetime support and their support in each of the last few live streams. */
export type ViewerSupportTotals = FunctionReturnType<typeof api.supporters.viewerTotals>;

/**
 * An event to publish on the engine's bus. `triggerId` is the key the runs it
 * starts report under; `triggeredBy` tags those runs (see
 * convex/lib/manualRunOrigin.ts).
 */
export type EngineTestEvent = Omit<FunctionArgs<typeof api.debug.fireTrigger>, "instanceId">;

/** Whether the engine published the event; `message` says why not. */
export type PublishedTestEvent = FunctionReturnType<typeof api.debug.fireTrigger>;

/** Which sections to back up, and whether to include each group's members. */
export type ConfigExportRequest = Omit<FunctionArgs<typeof api.configBackup.exportConfig>, "instanceId">;

/** A backup, as the chunks it was read into, and how to apply it. */
export type ConfigImportRequest = Omit<FunctionArgs<typeof api.configBackup.importConfig>, "instanceId">;

/** A workflow on the engine, as the pickers that list them need it. */
export interface EngineWorkflowOption {
  id: string;
  name: string;
}

/**
 * A short-lived event Convex records from an engine callback under a
 * correlation key, so a caller can follow work the engine does after the
 * request that started it has returned. Rows expire after about a minute.
 */
export type TransientEvent = Doc<"transientEvents">;

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

/** One scene on the engine, cached from its webhooks; `id` repeats `_id` and `widgets` is never missing. */
export type SceneRecord = FunctionReturnType<typeof api.scenes.list>[number];

/** A new scene: its name and, in the engine's stored JSON shapes, its widgets and layout. */
export type NewScene = Omit<FunctionArgs<typeof api.sceneActions.createScene>, "instanceId">;

/** The parts of a scene to replace; a field left out keeps its value. */
export type SceneChanges = Omit<FunctionArgs<typeof api.sceneActions.updateScene>, "instanceId" | "engineSceneId">;

/**
 * What the UI's workflow logic reads of a workflow: the engine's definition
 * and enabled flag, and the builder's nodes. Structural, so the pure libraries
 * work on any gateway's rows; a read returns the whole record, which has these.
 */
export type WorkflowRecord = Pick<Doc<"workflows">, "engineWorkflowId" | "definition" | "isEnabled" | "nodes">;

/** A value `${viewer.*}` resolves on the engine, for the condition builder. */
export type ViewerFact = FunctionReturnType<typeof api.viewerFacts.list>[number];

/** A workflow on the engine, mirrored from its webhooks. */
export type Workflow = Doc<"workflows">;

/** The workflow builder's catalog: the triggers and actions the installed modules register. */
export type WorkflowCatalog = NonNullable<FunctionReturnType<typeof api.workflowCatalog.get>>;

/** A manual run: the workflow by name or id, its parameters, and test-run options. */
export type WorkflowTrigger = Omit<FunctionArgs<typeof api.workflowActions.trigger>, "instanceId">;

/** How the engine answered a manual run; its progress arrives in transient events under `triggerId`. */
export type WorkflowTriggerResult = FunctionReturnType<typeof api.workflowActions.trigger>;

/** Whether the engine takes test-run options. */
export type TestRunCapabilities = FunctionReturnType<typeof api.workflowActions.testRunCapabilities>;

/** A recorded run to run again, whole or from one step. */
export type WorkflowReplay = Omit<FunctionArgs<typeof api.workflowActions.replay>, "instanceId">;

/** How stopping a run went: the engine's outcome, or `marked` when an older engine only marked the row. */
export type WorkflowCancelResult = FunctionReturnType<typeof api.workflowActions.cancelRun>;

/** A recorded run with its steps and the alerts it played; null when it is not recorded or not the caller's. */
export type WorkflowRunDetail = FunctionReturnType<typeof api.workflowRuns.runWithSteps>;

/** One recorded run of a workflow, as its run history lists it. */
export type RecordedWorkflowRun = FunctionReturnType<typeof api.workflowRuns.listForWorkflow>[number];

/** What prompted a workflow health resync; the server throttles repeats per instance. */
export type WorkflowHealthResyncTrigger = FunctionArgs<typeof api.workflowHealth.resync>["trigger"];

export type WorkflowHealthResyncResult = FunctionReturnType<typeof api.workflowHealth.resync>;

/** The instance's stream state, kept current by engine callbacks and polls. */
export type InstanceLiveState = Doc<"instanceLiveState">;

/** The mirror's sync bookkeeping: the schedule row plus the five most recent runs. */
export interface EngineSyncState {
  syncState: Doc<"instanceSync"> | null;
  currentRun: Doc<"syncRuns"> | null;
  recentRuns: Doc<"syncRuns">[];
}

export type EngineSyncRequest = { scheduled: true } | { scheduled: false; reason: "already-running" };

export type EngineConnectionTest = { ok: true } | { ok: false; error: string };

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

/** A callback Convex recorded from the engine, kept for debugging. */
export type WebhookEventId = Id<"engineEventLog">;

/** One webhook log entry without its payload, which is read on its own. */
export type WebhookEventSummary = FunctionReturnType<typeof api.engineEventLog.list>["page"][number];
