import { useCallback } from "react";
import type { EventLogGateway } from "@/engine/gateway";
import { NoInstanceSelectedError, useEngineScope } from "@/engine/scope";
import type { EventLogQuery, EventLogSelection, StreamEventFrame } from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { unsupportedRead, unsupportedRequest } from "./unsupported";

/**
 * The engine's own event log and its live push. The webhook log is the
 * record a dashboard keeps of the callbacks it received; an engine driven
 * directly sends none, so there is no such log.
 */
export function directEventLogGateway(runtime: DirectRuntime): EventLogGateway {
  const listEvents = (query?: EventLogQuery) => runtime.call("listEvents", (api) => api.listEvents(query));
  const settings = () => runtime.call("getEventLogSettings", (api) => api.getEventLogSettings());
  const setSelection = (selection: EventLogSelection) =>
    runtime.call("setEventLogSelection", (api) => api.setEventLogSelection(selection));

  return {
    useWebhookEvents: unsupportedRead("eventLog.useWebhookEvents"),
    useWebhookPayload: unsupportedRead("eventLog.useWebhookPayload"),
    useRetriggerRequest: unsupportedRequest("eventLog.useRetriggerRequest"),
    useStreamEventsSubscription: () => {
      const { instanceId } = useEngineScope();
      return useCallback(
        (types: readonly string[] | null, onFrame: (frame: StreamEventFrame) => void) => {
          if (instanceId === null) {
            throw new NoInstanceSelectedError();
          }
          return runtime.streamEvents.subscribe(types, onFrame);
        },
        [instanceId, runtime.streamEvents.subscribe]
      );
    },
    useEventsRequest: () => useEngineRequest(listEvents),
    useSettingsRequest: () => useEngineRequest(settings),
    useSetSelectionRequest: () => useEngineRequest(setSelection),
  };
}
