import type { DesktopHostState } from "@/engine/desktop-host";
import { enqueueShoutout, onShoutoutQueueChange, removeShoutout, reorderShoutouts, shoutoutQueue } from "./host";

// The UI state local mode keeps in the desktop app's Rust host rather than in
// the engine (the shoutout queue), through the
// host's commands.

export const localGatewayHost: DesktopHostState = {
  shoutoutQueue: {
    queue: shoutoutQueue,
    enqueue: enqueueShoutout,
    remove: removeShoutout,
    reorder: reorderShoutouts,
    onChange: onShoutoutQueueChange,
  },
};
