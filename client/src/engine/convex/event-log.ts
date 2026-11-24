import { api } from "@convex/_generated/api";
import { useConvex, usePaginatedQuery, useQuery } from "convex/react";
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
import { fromWebhookEventId, toWebhookEventId } from "./ids";
import { requireInstance, useInstanceAction, useScopeInstanceId } from "./scope";

// The webhook log is what Convex recorded from engine callbacks; the event log
// and its selection are the engine's own, read through role-checked Convex actions.

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

// Pushed events are what the engine forwarded to Convex since the page opened:
// the feed shows rows that arrive after the first answer, and the engine's
// event log, read separately, supplies everything before.

function useStreamEventsSubscription() {
  const convex = useConvex();
  const instanceId = useScopeInstanceId();
  return useCallback(
    (types: readonly string[], onFrame: (frame: StreamEventFrame) => void) => {
      const wanted = new Set(types);
      const watch = convex.watchQuery(api.streamEvents.recent, { instanceId: requireInstance(instanceId) });
      let seen: Set<string> | null = null;
      const read = () => {
        const rows = watch.localQueryResult();
        if (rows === undefined) {
          return;
        }
        if (seen === null) {
          seen = new Set(rows.map((row) => row.id));
          return;
        }
        for (const row of [...rows].reverse()) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            if (wanted.has(row.frame.type)) {
              onFrame(row.frame);
            }
          }
        }
      };
      read();
      return watch.onUpdate(read);
    },
    [convex, instanceId]
  );
}

function useEventsRequest() {
  const listEvents = useInstanceAction(api.engineLive.listEvents);
  return useCallback((query?: EventLogQuery) => listEvents({ query }), [listEvents]);
}

function useSettingsRequest() {
  const getSettings = useInstanceAction(api.engineLive.getEventLogSettings);
  return useCallback(() => getSettings({}), [getSettings]);
}

function useSetSelectionRequest() {
  const setSelection = useInstanceAction(api.engineLive.setEventLogSelection);
  return useCallback((selection: EventLogSelection) => setSelection({ selection }), [setSelection]);
}

export const convexEventLogGateway: EventLogGateway = {
  canRetrigger: true,
  useWebhookEvents,
  useWebhookPayload,
  useRetriggerRequest,
  useStreamEventsSubscription,
  useEventsRequest,
  useSettingsRequest,
  useSetSelectionRequest,
};
