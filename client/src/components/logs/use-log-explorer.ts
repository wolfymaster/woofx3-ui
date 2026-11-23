import type { LogRecordItem } from "@woofx3/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEngineGateway } from "@/engine/context";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { type LogFilter, logStreamUrl } from "./log-urls";

/** Whether new records are pushed into the list as the engine writes them. */
export type TailMode = "paused" | "live";

export interface LogExplorerConfig {
  /** How long a search box must sit still before it queries. */
  searchDebounceMs: number;
  /** Records kept in memory; the oldest drop off once a live tail passes it. */
  maxRecords: number;
  pageSize: number;
  /** Wait before asking for a new live address after the stream drops. */
  reconnectDelayMs: number;
}

export const DEFAULT_LOG_EXPLORER_CONFIG: LogExplorerConfig = {
  searchDebounceMs: 300,
  maxRecords: 5000,
  pageSize: 200,
  reconnectDelayMs: 1000,
};

export interface LogExplorer {
  records: LogRecordItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  /** The services that have written logs, for the filter. */
  services: string[];
}

/** `incoming` first, then what is held, one entry per record, capped at `limit`. */
function mergeNewest(held: LogRecordItem[], incoming: LogRecordItem, limit: number): LogRecordItem[] {
  if (held.some((record) => record.cursor === incoming.cursor)) {
    return held;
  }
  return [incoming, ...held].slice(0, limit);
}

export function useLogExplorer(
  filter: LogFilter,
  tail: TailMode,
  config: LogExplorerConfig = DEFAULT_LOG_EXPLORER_CONFIG
): LogExplorer {
  const requests = useEngineGateway().logs.useLogsRequests();
  const text = useDebouncedValue(filter.text, config.searchDebounceMs);
  const levelsKey = filter.levels.join(",");
  const servicesKey = filter.services.join(",");
  const [records, setRecords] = useState<LogRecordItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  // The query a page belongs to; an answer for an older one is dropped.
  const generation = useRef(0);

  const settledFilter = useRef<LogFilter>(filter);
  settledFilter.current = {
    levels: levelsKey === "" ? [] : (levelsKey.split(",") as LogFilter["levels"]),
    services: servicesKey === "" ? [] : servicesKey.split(","),
    text,
  };

  const { listFiles, query, access } = requests;

  useEffect(() => {
    let cancelled = false;
    listFiles()
      .then((files) => {
        if (!cancelled) {
          setServices([...new Set(files.map((file) => file.service))].sort());
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listFiles]);

  // `text`, `levelsKey` and `servicesKey` are what a new first page depends on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys stand for the filter
  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    setLoading(true);
    setError(null);
    query({ ...settledFilter.current, limit: config.pageSize })
      .then((page) => {
        if (generation.current === mine) {
          setRecords(page.records);
          setNextCursor(page.nextCursor);
        }
      })
      .catch((cause: unknown) => {
        if (generation.current === mine) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (generation.current === mine) {
          setLoading(false);
        }
      });
  }, [query, text, levelsKey, servicesKey, config.pageSize]);

  const loadMore = useCallback(() => {
    if (nextCursor === null || isLoadingMore || isLoading) {
      return;
    }
    const mine = generation.current;
    setLoadingMore(true);
    query({ ...settledFilter.current, cursor: nextCursor, limit: config.pageSize })
      .then((page) => {
        if (generation.current === mine) {
          setRecords((held) => [...held, ...page.records].slice(0, config.maxRecords));
          setNextCursor(page.nextCursor);
        }
      })
      .catch((cause: unknown) => {
        if (generation.current === mine) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => setLoadingMore(false));
  }, [query, nextCursor, isLoading, isLoadingMore, config.pageSize, config.maxRecords]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys stand for the filter
  useEffect(() => {
    if (tail === "paused") {
      return;
    }
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let lastId: string | null = null;

    const connect = () => {
      access("stream")
        .then((grant) => {
          if (stopped) {
            return;
          }
          const stream = new EventSource(logStreamUrl(grant, settledFilter.current, lastId));
          source = stream;
          stream.addEventListener("log", (event) => {
            const message = event as MessageEvent<string>;
            lastId = message.lastEventId;
            const record = JSON.parse(message.data) as LogRecordItem;
            setRecords((held) => mergeNewest(held, record, config.maxRecords));
          });
          // A closed source is a refused address (it expired or the engine restarted): ask for a fresh one.
          stream.addEventListener("error", () => {
            if (stream.readyState === EventSource.CLOSED && !stopped) {
              retry = setTimeout(connect, config.reconnectDelayMs);
            }
          });
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    connect();

    return () => {
      stopped = true;
      source?.close();
      if (retry !== null) {
        clearTimeout(retry);
      }
    };
  }, [tail, access, text, levelsKey, servicesKey, config.maxRecords, config.reconnectDelayMs]);

  return { records, isLoading, isLoadingMore, error, hasMore: nextCursor !== null, loadMore, services };
}
