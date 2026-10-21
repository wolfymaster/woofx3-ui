import { api } from "@convex/_generated/api";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useMemo } from "react";
import type { EventLogGateway } from "@/engine/gateway";
import type { InstanceId, Paginated, WebhookEventId, WebhookEventSummary } from "@/engine/types";
import { transport } from "@/lib/transport";
import { fromInstanceId, fromWebhookEventId, toWebhookEventId } from "./ids";

// The webhook log is what Convex recorded from engine callbacks; the event log
// and its selection are the engine's own, read over the live transport. The
// transport is a module singleton, so its functions keep their identity
// without memoising.

type WebhookEventRow = FunctionReturnType<typeof api.engineEventLog.list>["page"][number];

function toWebhookEventSummary(row: WebhookEventRow): WebhookEventSummary {
  return {
    id: toWebhookEventId(row._id),
    eventType: row.eventType,
    source: row.source,
    receivedAt: row.receivedAt,
    payloadLength: row.payloadLength,
  };
}

function useWebhookEvents(
  instanceId: InstanceId | null,
  eventType: string | null,
  initialNumItems: number
): Paginated<WebhookEventSummary> {
  const { results, status, isLoading, loadMore } = usePaginatedQuery(
    api.engineEventLog.list,
    instanceId ? { instanceId: fromInstanceId(instanceId), ...(eventType !== null ? { eventType } : {}) } : "skip",
    { initialNumItems }
  );
  const summaries = useMemo(() => results.map(toWebhookEventSummary), [results]);
  return { results: summaries, status, isLoading, loadMore };
}

function useWebhookPayload(logId: WebhookEventId) {
  return useQuery(api.engineEventLog.getPayload, { logId: fromWebhookEventId(logId) });
}

function useRetriggerRequest() {
  const retrigger = useAction(api.engineEventLog.retrigger);
  return useCallback(
    (instanceId: InstanceId, logId: WebhookEventId) =>
      retrigger({ instanceId: fromInstanceId(instanceId), logId: fromWebhookEventId(logId) }),
    [retrigger]
  );
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
