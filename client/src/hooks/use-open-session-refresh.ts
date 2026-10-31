import { useCallback, useEffect } from "react";
import { useEngineScope } from "@/engine/context";
import { useLiveState } from "@/engine/hooks/use-live-state";
import { useOpenSessionRefreshRequest } from "@/engine/hooks/use-stream-recap";
import { useAttendedInterval } from "@/hooks/use-attended-interval";
import { createPollThrottle } from "@/lib/poll-throttle";

/** How often a live stream's recap totals are refreshed while someone watches them. */
const LIVE_REFRESH_MS = 60_000;

// Module scope so the recap list, a recap page and the Recent Streams widget
// open together share one request. Convex also refuses a refresh while its
// stored snapshot is fresh, which covers other tabs and other viewers.
const refreshThrottle = createPollThrottle(LIVE_REFRESH_MS / 2);

/**
 * Keeps the open session's recap current while a page showing recaps is
 * open: once on mount, then every minute while the stream is live. The recaps
 * themselves arrive through the recap reads; this only asks for them to be
 * brought up to date.
 */
export function useOpenSessionRefresh(): void {
  const { instanceId } = useEngineScope();
  const refreshOpenSession = useOpenSessionRefreshRequest();
  const isLive = useLiveState()?.isLive ?? false;

  const refresh = useCallback(() => {
    if (!instanceId || !refreshThrottle.claim(instanceId)) {
      return;
    }
    // Best effort: a failed refresh leaves the last figures on screen, and
    // the engine's own summary arrives when the session ends either way.
    refreshOpenSession().catch(() => undefined);
  }, [instanceId, refreshOpenSession]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useAttendedInterval(refresh, LIVE_REFRESH_MS, isLive);
}
