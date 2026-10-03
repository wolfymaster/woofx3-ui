import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect } from "react";
import { useAttendedInterval } from "@/hooks/use-attended-interval";
import { useLiveState } from "@/hooks/use-live-state";
import { createPollThrottle } from "@/lib/poll-throttle";

/** How often a live stream's recap totals are refreshed while someone watches them. */
const LIVE_REFRESH_MS = 60_000;

// Module scope so the recap list, a recap page and the Recent Streams widget
// open together share one request. Convex also refuses a refresh while its
// stored snapshot is fresh, which covers other tabs and other viewers.
const refreshThrottle = createPollThrottle(LIVE_REFRESH_MS / 2);

/**
 * Keeps the stored summary of the engine's open session current while a page
 * showing recaps is open: once on mount, then every minute while the stream
 * is live. The summaries themselves arrive through the usual
 * `streamSessionSummaries` queries; this only asks Convex to take a snapshot.
 */
export function useOpenSessionRefresh(instanceId: Id<"instances"> | undefined): void {
  const refreshOpenSession = useAction(api.streamRecap.refreshOpenSession);
  const isLive = useLiveState()?.isLive ?? false;

  const refresh = useCallback(() => {
    if (!instanceId || !refreshThrottle.claim(instanceId)) {
      return;
    }
    // Best effort: a failed snapshot leaves the last stored one on screen, and
    // the engine's own summary arrives when the session ends either way.
    refreshOpenSession({ instanceId }).catch(() => undefined);
  }, [instanceId, refreshOpenSession]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useAttendedInterval(refresh, LIVE_REFRESH_MS, isLive);
}
