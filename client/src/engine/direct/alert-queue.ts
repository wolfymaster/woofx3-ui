import { ALERT_LIST_MAX_LIMIT } from "@woofx3/api";
import { EngineDisconnectedError } from "@/engine/errors";
import type { AlertQueueGateway } from "@/engine/gateway";
import type { AlertOverview, EngineAlert, OverlayPresence, ReadOptions } from "@/engine/types";
import { OVERLAY_PRESENCE_POLL_MS, overlayPresenceOf } from "@/lib/overlay-presence";
import { directKeys as k } from "./keys";
import { toEngineAlert } from "./map/alerts";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

function alertsRead(runtime: DirectRuntime, limit: number): EngineRead<EngineAlert[]> {
  return {
    queryKey: k.alertQueue.alerts(limit),
    queryFn: async () => {
      // The engine refuses a limit outside its range, so one is clamped into
      // it, as the Convex gateway clamps its own.
      const bounded = Math.min(Math.max(Math.trunc(limit), 1), ALERT_LIST_MAX_LIMIT);
      const page = await runtime.call("listAlerts", (api) => api.listAlerts({ limit: bounded }));
      const now = runtime.clock.now();
      return page.alerts.map((snapshot) => toEngineAlert(snapshot, now));
    },
  };
}

function overviewRead(runtime: DirectRuntime, hourStart: number): EngineRead<AlertOverview | null> {
  return {
    queryKey: k.alertQueue.overview(hourStart),
    queryFn: async () => {
      return runtime.call("getAlertOverview", (api) => api.getAlertOverview(hourStart));
    },
  };
}

/**
 * A read that fails says nothing about the overlay, so it is an answer here
 * rather than an error for the screen's boundary. A dropped session stays an
 * error, which keeps the last answer while the next session reads again.
 */
function overlayPresenceRead(runtime: DirectRuntime): EngineRead<OverlayPresence> {
  return {
    queryKey: k.alertQueue.overlayPresence(),
    queryFn: async () => {
      try {
        return overlayPresenceOf(await runtime.call("getAlertQueue", (api) => api.getAlertQueue()));
      } catch (error) {
        if (error instanceof EngineDisconnectedError) {
          throw error;
        }
        return "unknown";
      }
    },
  };
}

/**
 * The alerts the engine recorded, read from the engine and kept current by
 * its `alert.*` events. The queue controls answer as the engine does; the
 * rows they change arrive through those events.
 */
export function directAlertQueueGateway(runtime: DirectRuntime): AlertQueueGateway {
  const replay = (engineAlertId: string) => runtime.call("replayAlert", (api) => api.replayAlert(engineAlertId));
  const skipCurrent = () => runtime.call("skipCurrentAlert", (api) => api.skipCurrentAlert());
  const clearQueue = () => runtime.call("clearAlertQueue", (api) => api.clearAlertQueue());

  return {
    useAlerts: (limit) => useEngineQuery(runtime, alertsRead(runtime, limit)),
    useOverview: (hourStart) => useEngineQuery(runtime, overviewRead(runtime, hourStart)),
    useReplayRequest: () => useEngineRequest(replay),
    useSkipCurrentRequest: () => useEngineRequest(skipCurrent),
    useClearQueueRequest: () => useEngineRequest(clearQueue),
    useOverlayOpen: ({ enabled = true }: ReadOptions = {}) =>
      useEngineQuery(runtime, overlayPresenceRead(runtime), { enabled, refetchIntervalMs: OVERLAY_PRESENCE_POLL_MS }),
  };
}
