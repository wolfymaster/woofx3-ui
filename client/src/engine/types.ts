import type { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

export type { CompositionPreviewUrl } from "@convex/compositionPreview";
export type { AlertClearResult, AlertReplayResult, AlertSkipResult } from "@convex/lib/alertQueueResults";
export type { EngineCapability, EngineCapabilityReport } from "@convex/lib/engineCapabilities";
export type { ObsStatus } from "@convex/lib/engineObsStatus";
export type {
  HostedStorageUsage,
  PaginatedResourcesDto as ResourcePage,
  ResourceDto as Resource,
} from "@convex/resources";
export type {
  EngineInfo,
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  StreamEventFrame,
  UploadGrant,
} from "@woofx3/api";

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
