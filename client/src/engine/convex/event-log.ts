import { api } from "@convex/_generated/api";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { useCallback } from "react";
import type { EventLogGateway } from "@/engine/gateway";
import type { InstanceId, WebhookEventId } from "@/engine/types";
import { transport } from "@/lib/transport";

// The webhook log is what Convex recorded from engine callbacks; the event log
// and its selection are the engine's own, read over the live transport. The
// transport is a module singleton, so its functions keep their identity
// without memoising.

function useWebhookEvents(instanceId: InstanceId | null, eventType: string | null, initialNumItems: number) {
  return usePaginatedQuery(
    api.engineEventLog.list,
    instanceId ? { instanceId, ...(eventType !== null ? { eventType } : {}) } : "skip",
    { initialNumItems }
  );
}

function useWebhookPayload(logId: WebhookEventId) {
  return useQuery(api.engineEventLog.getPayload, { logId });
}

function useRetriggerRequest() {
  const retrigger = useAction(api.engineEventLog.retrigger);
  return useCallback((instanceId: InstanceId, logId: WebhookEventId) => retrigger({ instanceId, logId }), [retrigger]);
}

const subscribeStreamEvents: ReturnType<EventLogGateway["useStreamEventsSubscription"]> = (
  instanceId,
  types,
  onFrame
) => transport.subscribeStreamEvents(instanceId, types, onFrame);

const listEvents: ReturnType<EventLogGateway["useEventsRequest"]> = (instanceId, query) =>
  transport.listEvents(instanceId, query);

const getEventLogSettings: ReturnType<EventLogGateway["useSettingsRequest"]> = (instanceId) =>
  transport.getEventLogSettings(instanceId);

const setEventLogSelection: ReturnType<EventLogGateway["useSetSelectionRequest"]> = (instanceId, selection) =>
  transport.setEventLogSelection(instanceId, selection);

export const convexEventLogGateway: EventLogGateway = {
  useWebhookEvents,
  useWebhookPayload,
  useRetriggerRequest,
  useStreamEventsSubscription: () => subscribeStreamEvents,
  useEventsRequest: () => listEvents,
  useSettingsRequest: () => getEventLogSettings,
  useSetSelectionRequest: () => setEventLogSelection,
};
