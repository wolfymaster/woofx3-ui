import { useVirtualizer } from "@tanstack/react-virtual";
import type { LogLevel } from "@woofx3/api";
import { Download, Radio, ScrollText, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useEngineGateway } from "@/engine/context";
import { EMPTY_LOG_FILTER, type LogFilter, logExportUrl } from "./log-urls";
import { LogRow } from "./log-row";
import { type TailMode, useLogExplorer } from "./use-log-explorer";

const ALL = "all";
const LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const ESTIMATED_ROW_PX = 28;
const OVERSCAN_ROWS = 20;
/** Rows from the end at which the next page is asked for. */
const LOAD_AHEAD_ROWS = 30;

/** Everything at or above `level`, the way a log level is usually filtered. */
function levelsFrom(level: LogLevel): LogLevel[] {
  return LEVELS.slice(LEVELS.indexOf(level));
}

export function LogExplorer() {
  const logs = useEngineGateway().logs;
  const requests = logs.useLogsRequests();
  const canExport = logs.useCanExport();
  const [filter, setFilter] = useState<LogFilter>(EMPTY_LOG_FILTER);
  const [minLevel, setMinLevel] = useState<LogLevel | typeof ALL>(ALL);
  const [tail, setTail] = useState<TailMode>("paused");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [exportError, setExportError] = useState<string | null>(null);
  const explorer = useLogExplorer(filter, tail);
  const scroller = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: explorer.records.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    overscan: OVERSCAN_ROWS,
    getItemKey: (index) => explorer.records[index].cursor,
  });
  const items = virtualizer.getVirtualItems();
  const lastVisible = items.at(-1)?.index ?? 0;

  const { hasMore, loadMore, records } = explorer;
  useEffect(() => {
    if (hasMore && lastVisible >= records.length - LOAD_AHEAD_ROWS) {
      loadMore();
    }
  }, [hasMore, loadMore, lastVisible, records.length]);

  const toggle = useCallback((cursor: string) => {
    setExpanded((held) => {
      const next = new Set(held);
      if (!next.delete(cursor)) {
        next.add(cursor);
      }
      return next;
    });
  }, []);

  const download = async () => {
    setExportError(null);
    try {
      window.location.assign(logExportUrl(await requests.access("export")));
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search messages and fields"
            value={filter.text}
            onChange={(event) => setFilter({ ...filter, text: event.target.value })}
          />
        </div>
        <Select
          value={minLevel}
          onValueChange={(value) => {
            const level = value as LogLevel | typeof ALL;
            setMinLevel(level);
            setFilter({ ...filter, levels: level === ALL ? [] : levelsFrom(level) });
          }}
        >
          <SelectTrigger className="w-36" aria-label="Minimum level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All levels</SelectItem>
            {LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {level} and above
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filter.services[0] ?? ALL}
          onValueChange={(value) => setFilter({ ...filter, services: value === ALL ? [] : [value] })}
        >
          <SelectTrigger className="w-40" aria-label="Service">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All services</SelectItem>
            {explorer.services.map((service) => (
              <SelectItem key={service} value={service}>
                {service}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant={tail === "live" ? "default" : "outline"} onClick={() => setTail(tail === "live" ? "paused" : "live")}>
          <Radio className="mr-2 size-4" />
          {tail === "live" ? "Live" : "Go live"}
        </Button>
        {canExport ? (
          <Button variant="outline" onClick={download}>
            <Download className="mr-2 size-4" />
            Download
          </Button>
        ) : null}
      </div>
      {explorer.error !== null || exportError !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {exportError ?? explorer.error}
        </p>
      ) : null}
      <div ref={scroller} className="h-[calc(100vh-17rem)] overflow-auto rounded-md border bg-card">
        {explorer.isLoading ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 12 }, (_, row) => (
              <Skeleton key={row} className="h-5 w-full" />
            ))}
          </div>
        ) : records.length === 0 ? (
          <EmptyState icon={ScrollText} title="No logs match" description="Try a wider time range, a lower level, or a shorter search." />
        ) : (
          <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
            {items.map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <LogRow record={records[item.index]} expanded={expanded.has(records[item.index].cursor)} onToggle={toggle} />
              </div>
            ))}
          </div>
        )}
        {explorer.isLoadingMore ? <p className="p-2 text-center text-xs text-muted-foreground">Loading older logs...</p> : null}
      </div>
    </div>
  );
}
