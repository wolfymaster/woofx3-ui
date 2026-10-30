import { ALERT_LIST_MAX_LIMIT, ENGINE_CAPABILITIES } from "@woofx3/api";
import type { AlertQueueGateway } from "@/engine/gateway";
import type { AlertOverview, EngineAlert } from "@/engine/types";
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

/** Null from an engine that cannot total its alerts, which has nothing to show. */
function overviewRead(runtime: DirectRuntime, hourStart: number): EngineRead<AlertOverview | null> {
  return {
    queryKey: k.alertQueue.overview(hourStart),
    queryFn: async () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.alertsOverview)) {
        return null;
      }
      return runtime.call("getAlertOverview", (api) => api.getAlertOverview(hourStart));
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
  };
}
