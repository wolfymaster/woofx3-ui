import type { Doc, Id } from "@convex/_generated/dataModel";

export type { EngineCapability, EngineCapabilityReport } from "@convex/lib/engineCapabilities";
export type { ObsStatus } from "@convex/lib/engineObsStatus";
export type {
  HostedStorageUsage,
  PaginatedResourcesDto as ResourcePage,
  ResourceDto as Resource,
} from "@convex/resources";
export type { EngineInfo, UploadGrant } from "@woofx3/api";

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
