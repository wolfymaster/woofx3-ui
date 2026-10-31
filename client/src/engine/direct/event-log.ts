import { useInfiniteQuery } from "@tanstack/react-query";
import { ENGINE_CAPABILITIES, type EventLogPage } from "@woofx3/api";
import { useCallback } from "react";
import { EngineDisconnectedError } from "@/engine/errors";
import type { EventLogGateway } from "@/engine/gateway";
import { NoInstanceSelectedError, useEngineScope } from "@/engine/scope";
import type {
  EventLogQuery,
  EventLogSelection,
  Paginated,
  StreamEventFrame,
  WebhookEventId,
  WebhookEventSummary,
} from "@/engine/types";
import { toWebhookEventId } from "./ids";
import { directKeys as k } from "./keys";
import { useConnected, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { unsupportedRequest } from "./unsupported";

/** The engine accepts 1 to 100 events a page. */
const MAX_PAGE_SIZE = 100;

const EMPTY_PAGE: EventLogPage = { events: [], nextCursor: null };

function payloadOf(frame: StreamEventFrame): string {
  return JSON.stringify(frame.data);
}

function toWebhookEventSummary(frame: StreamEventFrame & { id: string }): WebhookEventSummary {
  return {
    id: toWebhookEventId(frame.id),
    eventType: frame.type,
    source: "webhook",
    receivedAt: Date.parse(frame.time),
    payloadLength: payloadOf(frame).length,
  };
}

/**
 * The engine's own event log and its live push. A dashboard with no account
 * has no record of callbacks to show, so the log screen reads the engine's
 * log instead; the engine cannot fire a logged event again, so there is no
 * retrigger.
 */
export function directEventLogGateway(runtime: DirectRuntime): EventLogGateway {
  const listEvents = (query?: EventLogQuery) => runtime.call("listEvents", (api) => api.listEvents(query));
  const settings = () => runtime.call("getEventLogSettings", (api) => api.getEventLogSettings());
  const setSelection = (selection: EventLogSelection) =>
    runtime.call("setEventLogSelection", (api) => api.setEventLogSelection(selection));

  // A log the engine does not keep reads as empty rather than failing the screen.
  const readPage = async (query: EventLogQuery): Promise<EventLogPage> => {
    if (!runtime.supports(ENGINE_CAPABILITIES.eventsLog)) {
      return EMPTY_PAGE;
    }
    return listEvents(query);
  };

  const useWebhookEvents = (eventType: string | null, initialNumItems: number): Paginated<WebhookEventSummary> => {
    const { instanceId } = useEngineScope();
    const connected = useConnected(runtime);
    const limit = Math.min(Math.max(Math.trunc(initialNumItems), 1), MAX_PAGE_SIZE);
    const query = useInfiniteQuery(
      {
        queryKey: k.eventLog.pages(eventType),
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) =>
          readPage({ types: eventType === null ? undefined : [eventType], cursor: pageParam, limit }),
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        select: (data) => data.pages.flatMap((page) => page.events),
        enabled: instanceId !== null && connected,
        throwOnError: (error) => !(error instanceof EngineDisconnectedError),
      },
      runtime.queryClient
    );
    const events = query.data;
    const status = ((): Paginated<WebhookEventSummary>["status"] => {
      if (events === undefined) {
        return "LoadingFirstPage";
      }
      if (query.isFetchingNextPage) {
        return "LoadingMore";
      }
      return query.hasNextPage ? "CanLoadMore" : "Exhausted";
    })();
    return {
      results: (events ?? []).flatMap((frame) =>
        frame.id === undefined ? [] : [toWebhookEventSummary({ ...frame, id: frame.id })]
      ),
      status,
      isLoading: events === undefined,
      loadMore: () => {
        if (query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
    };
  };

  // The payload is read from the pages the log screen already loaded: the
  // engine has no read of a single logged event.
  const useWebhookPayload = (logId: WebhookEventId) =>
    useEngineQuery(runtime, {
      queryKey: k.eventLog.payload(logId),
      queryFn: async () => {
        for (const [, data] of runtime.queryClient.getQueriesData<{ pages: EventLogPage[] }>({
          queryKey: k.eventLog.allPages,
        })) {
          const frame = data?.pages.flatMap((page) => page.events).find((candidate) => candidate.id === logId);
          if (frame !== undefined) {
            return payloadOf(frame);
          }
        }
        return null;
      },
    });

  return {
    canRetrigger: false,
    useWebhookEvents,
    useWebhookPayload,
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
