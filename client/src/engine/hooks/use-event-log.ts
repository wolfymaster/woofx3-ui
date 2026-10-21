import { useStore } from "@nanostores/react";
import { useEffect, useMemo, useState } from "react";
import { useEngineGateway, useEngineScope } from "@/engine/context";
import type { StreamEventFrame } from "@/engine/types";
import type { ActivityEvent } from "@/lib/activity-feed";
import { $engineConnected } from "@/lib/transport/engine-connection";

/** One page: the engine keeps a few days of detail, and the feed shows the latest of it. */
const HISTORY_LIMIT = 50;
/** Pushed events kept on top of history. Past this the oldest fall off; history covers them. */
const LIVE_LIMIT = 200;

/**
 * - `ready`: history loaded.
 * - `unsupported`: the engine predates the event log, so the feed is live only.
 * - `error`: the read failed; the feed is live only until the next reconnect.
 */
export type EventLogStatus = "loading" | "ready" | "unsupported" | "error";

function withId(frame: StreamEventFrame): ActivityEvent {
  // A pushed frame without an id still needs one key; it can never be joined
  // to an alert or matched against history, which always carries ids.
  return { ...frame, id: frame.id ?? crypto.randomUUID() };
}

/**
 * The engine's recent events of `types`: a page of its event log, re-read
 * whenever the types change and on every reconnect because the push is not
 * gapless, with pushed events on top. Newer copies come first, so a consumer
 * that dedupes by id keeps the pushed one.
 *
 * - `types` an array: history and push of exactly those types. An empty list
 *   reads no history at all, since the engine reads an empty filter as every
 *   type.
 * - `types` null: an engine without an event log; no history, and whatever
 *   the engine pushes.
 * - `types` undefined: not known yet; nothing is read or subscribed.
 */
export function useEventLog(types: readonly string[] | null | undefined): {
  events: ActivityEvent[];
  status: EventLogStatus;
} {
  const { instanceId } = useEngineScope();
  const { eventLog } = useEngineGateway();
  const subscribeStreamEvents = eventLog.useStreamEventsSubscription();
  const listEvents = eventLog.useEventsRequest();
  const connected = useStore($engineConnected);
  const [history, setHistory] = useState<ActivityEvent[]>([]);
  const [live, setLive] = useState<ActivityEvent[]>([]);
  const [historyStatus, setHistoryStatus] = useState<EventLogStatus>("loading");
  // A content key: `types` gets a new identity on every render.
  const typesKey = types ? [...types].sort().join(",") : types === null ? null : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: instanceId resets the feed for a different engine
  useEffect(() => {
    setHistory([]);
    setLive([]);
    setHistoryStatus("loading");
  }, [instanceId]);

  useEffect(() => {
    if (!instanceId || typesKey === undefined) {
      return;
    }
    const wanted = typesKey === null ? null : typesKey.split(",").filter(Boolean);
    return subscribeStreamEvents(wanted, (frame) => {
      setLive((previous) => [withId(frame), ...previous].slice(0, LIVE_LIMIT));
    });
  }, [instanceId, typesKey, subscribeStreamEvents]);

  useEffect(() => {
    if (!instanceId || !connected || typeof typesKey !== "string") {
      return;
    }
    const wanted = typesKey.split(",").filter(Boolean);
    if (wanted.length === 0) {
      setHistory([]);
      setHistoryStatus("ready");
      return;
    }
    let cancelled = false;
    listEvents({ types: wanted, limit: HISTORY_LIMIT })
      .then((page) => {
        if (!cancelled) {
          setHistory(page.events.map(withId));
          setHistoryStatus("ready");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn("[Events] Could not read the engine's event log:", err);
          setHistoryStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, connected, typesKey, listEvents]);

  const events = useMemo(() => [...live, ...history], [live, history]);
  const status = typesKey === null ? "unsupported" : typesKey === undefined ? "loading" : historyStatus;
  return { events, status };
}
