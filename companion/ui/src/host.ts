import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  COMMANDS,
  type LocalEngineSession,
  type MarkerRequestOutcome,
  SHOUTOUT_QUEUE_EVENT,
  type ShoutoutChannel,
  type ShoutoutEnqueued,
  type ShoutoutEntryId,
  type ShoutoutQueueView,
  STREAM_START_MARKER_EVENT,
  type StreamStartMarker,
} from "./generated/window";

export type {
  LocalEngineSession,
  MarkerRequestOutcome,
  ShoutoutChannel,
  ShoutoutEnqueued,
  ShoutoutEntry,
  ShoutoutEntryId,
  ShoutoutQueueView,
  StreamStartMarker,
} from "./generated/window";

/** What the webview needs to open its own capnweb session with the local engine. */
export async function localEngineSession(): Promise<LocalEngineSession> {
  return invoke<LocalEngineSession>(COMMANDS.local_engine_session);
}

// ==================== Local-mode UI state ====================
// The shoutout queue and the stream start marker, which this host keeps for
// the window in local mode. Every command below rejects outside local mode.
// The argument names are the commands' parameter names in camelCase, as
// Tauri expects them.

export type EnqueueShoutoutArgs = { channel: ShoutoutChannel };
export type RemoveShoutoutArgs = { entryId: ShoutoutEntryId };
export type ReorderShoutoutsArgs = { entryIds: ShoutoutEntryId[] };

export async function shoutoutQueue(): Promise<ShoutoutQueueView> {
  return invoke<ShoutoutQueueView>(COMMANDS.shoutout_queue);
}

/** A channel already waiting keeps its place. */
export async function enqueueShoutout(channel: ShoutoutChannel): Promise<ShoutoutEnqueued> {
  const args: EnqueueShoutoutArgs = { channel };
  return invoke<ShoutoutEnqueued>(COMMANDS.enqueue_shoutout, args);
}

/** Rejects when the entry is no longer queued. */
export async function removeShoutout(entryId: ShoutoutEntryId): Promise<void> {
  const args: RemoveShoutoutArgs = { entryId };
  return invoke<void>(COMMANDS.remove_shoutout, args);
}

/** An entry gone meanwhile is skipped; entries left out follow in their order. */
export async function reorderShoutouts(entryIds: ShoutoutEntryId[]): Promise<void> {
  const args: ReorderShoutoutsArgs = { entryIds };
  return invoke<void>(COMMANDS.reorder_shoutouts, args);
}

export function onShoutoutQueueChange(handler: (queue: ShoutoutQueueView) => void): Promise<() => void> {
  return listen<ShoutoutQueueView>(SHOUTOUT_QUEUE_EVENT, (event) => handler(event.payload));
}

export async function streamStartMarker(): Promise<StreamStartMarker> {
  return invoke<StreamStartMarker>(COMMANDS.stream_start_marker);
}

/** Drops the "Stream start" marker now when the stream is live, else when it next goes live. */
export async function requestStreamStartMarker(): Promise<MarkerRequestOutcome> {
  return invoke<MarkerRequestOutcome>(COMMANDS.request_stream_start_marker);
}

export function onStreamStartMarkerChange(handler: (marker: StreamStartMarker) => void): Promise<() => void> {
  return listen<StreamStartMarker>(STREAM_START_MARKER_EVENT, (event) => handler(event.payload));
}
