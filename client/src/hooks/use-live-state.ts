import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useEffect } from "react";
import { useInstance } from "@/hooks/use-instance";
import { createPollThrottle } from "@/lib/poll-throttle";

// Single entry point for the current instance's live state. Every consumer
// reads through this hook rather than wiring up the query and the poll action
// itself, for the same reason usePlatformEvents owns the EventSub client: N
// components wanting the same fact should not produce N calls to Twitch.
//
// The Convex query needs no help — five components subscribing to
// getForInstance is already one subscription. The poll did: it's an action, so
// every caller was its own engine round trip on mount. A dashboard can easily
// show three live-state consumers at once (the status bar, the Stream Status
// widget, Stream Stats in the rail), and remounting one — a panel switch,
// opening the rail flyout — fired another.
//
// The window is generous because this call only buys instant freshness on
// open: instanceLiveState is normally kept current by STREAM_ONLINE/OFFLINE
// webhook pushes, and self-heals in the background via the `stream live state
// sweep` cron (convex/crons.ts) with no browser open at all.
const POLL_WINDOW_MS = 60_000;

// Module scope, not a ref: the throttle is shared across every component on
// the page, which is the entire point.
const pollThrottle = createPollThrottle(POLL_WINDOW_MS);

/** Exposed for tests and for a deliberate refresh; a fresh page load already starts clean. */
export function resetLiveStatePollThrottle(): void {
  pollThrottle.reset();
}

export function useLiveState() {
  const { instance } = useInstance();
  const liveState = useQuery(api.instanceLiveState.getForInstance, instance ? { instanceId: instance._id } : "skip");
  const pollLiveState = useAction(api.streamStatus.pollLiveState);

  const instanceId = instance?._id;

  useEffect(() => {
    if (!instanceId) {
      return;
    }
    // A failed poll still holds the window: the cron sweep is the retry path,
    // and letting every mount retry would hammer an engine that is already
    // unhealthy.
    if (!pollThrottle.claim(instanceId)) {
      return;
    }
    void pollLiveState({ instanceId });
  }, [instanceId, pollLiveState]);

  return liveState;
}
