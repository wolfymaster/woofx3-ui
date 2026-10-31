import type { DesktopHostState, StreamStartMarkerRequest } from "@/engine/desktop-host";
import {
  enqueueShoutout,
  type MarkerRequestOutcome,
  onShoutoutQueueChange,
  onStreamStartMarkerChange,
  removeShoutout,
  reorderShoutouts,
  requestStreamStartMarker,
  type StreamStartMarker,
  shoutoutQueue,
  streamStartMarker,
} from "./host";

// The UI state local mode keeps in the desktop app's Rust host rather than in
// the engine (the stream start marker and the shoutout queue), through the
// host's commands.

/** Only a marker still waiting for the stream counts: one being dropped already has its live stream. */
function isWaiting(marker: StreamStartMarker): boolean {
  return marker.kind === "pending";
}

function toStreamStartMarkerRequest(outcome: MarkerRequestOutcome): StreamStartMarkerRequest {
  switch (outcome.status) {
    case "done": {
      return { status: "done" };
    }
    case "queued": {
      return { status: "queued", reason: outcome.reason };
    }
    case "failed": {
      return { status: "failed", message: outcome.message };
    }
  }
}

export const localGatewayHost: DesktopHostState = {
  streamStartMarkers: {
    isPending: async () => isWaiting(await streamStartMarker()),
    onPendingChange: (listener) => onStreamStartMarkerChange((marker) => listener(isWaiting(marker))),
    request: async () => toStreamStartMarkerRequest(await requestStreamStartMarker()),
  },
  shoutoutQueue: {
    queue: shoutoutQueue,
    enqueue: enqueueShoutout,
    remove: removeShoutout,
    reorder: reorderShoutouts,
    onChange: onShoutoutQueueChange,
  },
};
