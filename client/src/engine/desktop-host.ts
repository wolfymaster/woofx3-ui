import type {
  ShoutoutEntryId as HostShoutoutEntryId,
  ShoutoutChannel,
  ShoutoutEnqueued,
  ShoutoutQueueView,
} from "@/desktop/host";

// UI state the desktop app's host keeps for a gateway that runs without an
// account. Declared apart from any gateway, so the desktop shell can supply it
// without reaching into the adapter that uses it.

/** What a request for the "Stream start" marker came to. */
export type StreamStartMarkerRequest =
  | { status: "done" }
  | { status: "queued"; reason: string }
  | { status: "failed"; message: string };

/**
 * Where local mode keeps the "Stream start" marker. Twitch only marks a live
 * broadcast, so a marker asked for before the stream starts waits for it, in
 * something that outlives the page.
 */
export interface StreamStartMarkers {
  /** Whether a requested marker is waiting for the stream to go live. */
  isPending(): Promise<boolean>;
  /** Calls `listener` whenever that answer changes; resolves with the unsubscribe once listening. */
  onPendingChange(listener: (pending: boolean) => void): Promise<() => void>;
  /** Drops the marker now when the stream is live, else when it next goes live. */
  request(): Promise<StreamStartMarkerRequest>;
}

/**
 * The desktop host's shoutout queue. The host owns the queue and works
 * through it on a schedule; the engine only sends each shoutout, so the
 * queue is not in the engine's data. Passed in rather than imported so the
 * gateway never loads Tauri in a build that has none.
 */
export interface ShoutoutQueueHost {
  queue(): Promise<ShoutoutQueueView>;
  enqueue(channel: ShoutoutChannel): Promise<ShoutoutEnqueued>;
  remove(entryId: HostShoutoutEntryId): Promise<void>;
  reorder(entryIds: HostShoutoutEntryId[]): Promise<void>;
  /** Resolves to the function that stops listening. */
  onChange(handler: (queue: ShoutoutQueueView) => void): Promise<() => void>;
}

/** What the direct gateway keeps outside the engine, held by the desktop host for local mode. */
export interface DesktopHostState {
  readonly streamStartMarkers: StreamStartMarkers;
  readonly shoutoutQueue: ShoutoutQueueHost;
}
