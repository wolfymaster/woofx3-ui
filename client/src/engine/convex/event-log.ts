import { api } from "@convex/_generated/api";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useMemo } from "react";
import type { EventLogGateway } from "@/engine/gateway";
import type {
  EventLogQuery,
  EventLogSelection,
  Paginated,
  StreamEventFrame,
  WebhookEventId,
  WebhookEventSummary,
} from "@/engine/types";
import { transport } from "@/lib/transport";
import { fromWebhookEventId, toWebhookEventId } from "./ids";
import { requireInstance, useInstanceAction, useScopeInstanceId } from "./scope";

// The webhook log is what Convex recorded from engine callbacks; the event log
// and its selection are the engine's own, read over the live transport.

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

function useWebhookEvents(eventType: string | null, initialNumItems: number): Paginated<WebhookEventSummary> {
  const instanceId = useScopeInstanceId();
  const { results, status, isLoading, loadMore } = usePaginatedQuery(
    api.engineEventLog.list,
    instanceId ? { instanceId, ...(eventType !== null ? { eventType } : {}) } : "skip",
    { initialNumItems }
  );
  const summaries = useMemo(() => results.map(toWebhookEventSummary), [results]);
  return { results: summaries, status, isLoading, loadMore };
}

function useWebhookPayload(logId: WebhookEventId) {
  return useQuery(api.engineEventLog.getPayload, { logId: fromWebhookEventId(logId) });
}

function useRetriggerRequest() {
  const retrigger = useInstanceAction(api.engineEventLog.retrigger);
  return useCallback((logId: WebhookEventId) => retrigger({ logId: fromWebhookEventId(logId) }), [retrigger]);
}

// The live transport holds one session, to the current instance's engine;
// these still refuse while the scope has no instance, like every other call.

function useStreamEventsSubscription() {
  const instanceId = useScopeInstanceId();
  return useCallback(
    (types: readonly string[] | null, onFrame: (frame: StreamEventFrame) => void) =>
      transport.subscribeStreamEvents(requireInstance(instanceId), types, onFrame),
    [instanceId]
  );
}

function useEventsRequest() {
  const instanceId = useScopeInstanceId();
  return useCallback(
    async (query?: EventLogQuery) => transport.listEvents(requireInstance(instanceId), query),
    [instanceId]
  );
}

function useSettingsRequest() {
  const instanceId = useScopeInstanceId();
  return useCallback(async () => transport.getEventLogSettings(requireInstance(instanceId)), [instanceId]);
}

function useSetSelectionRequest() {
  const instanceId = useScopeInstanceId();
  return useCallback(
    async (selection: EventLogSelection) => transport.setEventLogSelection(requireInstance(instanceId), selection),
    [instanceId]
  );
}

export const convexEventLogGateway: EventLogGateway = {
  useWebhookEvents,
  useWebhookPayload,
  useRetriggerRequest,
  useStreamEventsSubscription,
  useEventsRequest,
  useSettingsRequest,
  useSetSelectionRequest,
};
