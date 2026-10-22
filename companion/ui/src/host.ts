import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * What the webview needs to open its own capnweb session with the local
 * engine. Must match `LocalEngineSession` in companion/src-tauri/src/state.rs
 * (serde tag = "kind").
 */
export type LocalEngineSession =
  | { kind: "notLocal" }
  | { kind: "starting" }
  | { kind: "ready"; apiUrl: string; clientId: string; clientSecret: string }
  | { kind: "failed"; reason: string };

/** Must match `local_engine_session` in companion/src-tauri/src/lib.rs. It takes no arguments. */
export const LOCAL_ENGINE_SESSION_COMMAND = "local_engine_session";

export type LocalEngineSessionArgs = Record<string, never>;

export async function localEngineSession(): Promise<LocalEngineSession> {
  const args: LocalEngineSessionArgs = {};
  return invoke<LocalEngineSession>(LOCAL_ENGINE_SESSION_COMMAND, args);
}

// ==================== Local-mode UI state ====================
// The shoutout queue and the stream start marker, which this host keeps for
// the window in local mode. Every command below rejects outside local mode.

/** Milliseconds since the Unix epoch on this PC's clock. */
export type EpochMillis = number;

/** Must match `ShoutoutEntryId` in companion/core/src/host/shoutouts.rs. */
export type ShoutoutEntryId = number;

/** The channel to shout out. Must match `ShoutoutChannel` in companion/core/src/host/shoutouts.rs. */
export type ShoutoutChannel = {
  twitchUserId: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
  /** `partner`, `affiliate`, or empty for neither. */
  broadcasterType: string | null;
};

/** A channel waiting in the queue. Must match `ShoutoutEntry` in companion/core/src/host/shoutouts.rs. */
export type ShoutoutEntry = {
  id: ShoutoutEntryId;
  twitchUserId: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
  broadcasterType: string | null;
  attempts: number;
  /** Not tried again before this. */
  nextEligibleAt: EpochMillis;
  lastError: string | null;
};

/** Must match `ShoutoutQueueView` in companion/core/src/host/shoutouts.rs. */
export type ShoutoutQueueView = {
  /** In queue order. */
  entries: ShoutoutEntry[];
  /** Why no shoutout is being sent, while none can be; null otherwise. */
  pausedReason: string | null;
};

/** Must match `ShoutoutEnqueued` in companion/core/src/host/shoutouts.rs. */
export type ShoutoutEnqueued = {
  id: ShoutoutEntryId;
  /** 1-based, in queue order. */
  position: number;
  /** The channel was already waiting, so it kept its place. */
  alreadyQueued: boolean;
};

/** Must match `StreamStartMarker` in companion/core/src/host/stream_marker.rs (serde tag = "kind"). */
export type StreamStartMarker =
  | { kind: "idle" }
  | { kind: "pending"; requestedAt: EpochMillis }
  /** The stream is live and the marker is being dropped. */
  | { kind: "dropping" }
  | { kind: "dropped"; droppedAt: EpochMillis }
  | { kind: "failed"; message: string };

/** Must match `MarkerRequestOutcome` in companion/core/src/host/stream_marker.rs (serde tag = "status"). */
export type MarkerRequestOutcome =
  | { status: "done" }
  | { status: "queued"; reason: string }
  | { status: "failed"; message: string };

/** Must match `SHOUTOUT_QUEUE_EVENT` in companion/src-tauri/src/state.rs. */
export const SHOUTOUT_QUEUE_EVENT = "companion://shoutout-queue";

/** Must match `STREAM_START_MARKER_EVENT` in companion/src-tauri/src/state.rs. */
export const STREAM_START_MARKER_EVENT = "companion://stream-start-marker";

/** Must match the command names in companion/src-tauri/src/command_names.rs. */
export const SHOUTOUT_QUEUE_COMMAND = "shoutout_queue";
export const ENQUEUE_SHOUTOUT_COMMAND = "enqueue_shoutout";
export const REMOVE_SHOUTOUT_COMMAND = "remove_shoutout";
export const REORDER_SHOUTOUTS_COMMAND = "reorder_shoutouts";
export const STREAM_START_MARKER_COMMAND = "stream_start_marker";
export const REQUEST_STREAM_START_MARKER_COMMAND = "request_stream_start_marker";

export type ShoutoutQueueArgs = Record<string, never>;
export type EnqueueShoutoutArgs = { channel: ShoutoutChannel };
export type RemoveShoutoutArgs = { entryId: ShoutoutEntryId };
export type ReorderShoutoutsArgs = { entryIds: ShoutoutEntryId[] };
export type StreamStartMarkerArgs = Record<string, never>;
export type RequestStreamStartMarkerArgs = Record<string, never>;

export async function shoutoutQueue(): Promise<ShoutoutQueueView> {
  const args: ShoutoutQueueArgs = {};
  return invoke<ShoutoutQueueView>(SHOUTOUT_QUEUE_COMMAND, args);
}

/** A channel already waiting keeps its place. */
export async function enqueueShoutout(channel: ShoutoutChannel): Promise<ShoutoutEnqueued> {
  const args: EnqueueShoutoutArgs = { channel };
  return invoke<ShoutoutEnqueued>(ENQUEUE_SHOUTOUT_COMMAND, args);
}

/** Rejects when the entry is no longer queued. */
export async function removeShoutout(entryId: ShoutoutEntryId): Promise<void> {
  const args: RemoveShoutoutArgs = { entryId };
  return invoke<void>(REMOVE_SHOUTOUT_COMMAND, args);
}

/** An entry gone meanwhile is skipped; entries left out follow in their order. */
export async function reorderShoutouts(entryIds: ShoutoutEntryId[]): Promise<void> {
  const args: ReorderShoutoutsArgs = { entryIds };
  return invoke<void>(REORDER_SHOUTOUTS_COMMAND, args);
}

export function onShoutoutQueueChange(handler: (queue: ShoutoutQueueView) => void): Promise<() => void> {
  return listen<ShoutoutQueueView>(SHOUTOUT_QUEUE_EVENT, (event) => handler(event.payload));
}

export async function streamStartMarker(): Promise<StreamStartMarker> {
  const args: StreamStartMarkerArgs = {};
  return invoke<StreamStartMarker>(STREAM_START_MARKER_COMMAND, args);
}

/** Drops the "Stream start" marker now when the stream is live, else when it next goes live. */
export async function requestStreamStartMarker(): Promise<MarkerRequestOutcome> {
  const args: RequestStreamStartMarkerArgs = {};
  return invoke<MarkerRequestOutcome>(REQUEST_STREAM_START_MARKER_COMMAND, args);
}

export function onStreamStartMarkerChange(handler: (marker: StreamStartMarker) => void): Promise<() => void> {
  return listen<StreamStartMarker>(STREAM_START_MARKER_EVENT, (event) => handler(event.payload));
}
