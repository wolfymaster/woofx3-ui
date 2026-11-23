import type { LogLevel, LogRecordItem } from "@woofx3/api";
import { ChevronRight } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<LogLevel, string> = {
  trace: "text-muted-foreground",
  debug: "text-muted-foreground",
  info: "text-sky-600 dark:text-sky-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
  fatal: "text-red-700 dark:text-red-300 font-bold",
  unknown: "text-muted-foreground italic",
};

/** The clock time of an ISO timestamp, to the millisecond; an unparseable one is shown as written. */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  const part = (value: number, width: number) => String(value).padStart(width, "0");
  return `${part(date.getHours(), 2)}:${part(date.getMinutes(), 2)}:${part(date.getSeconds(), 2)}.${part(date.getMilliseconds(), 3)}`;
}

interface LogRowProps {
  record: LogRecordItem;
  expanded: boolean;
  onToggle: (cursor: string) => void;
}

/** One record on one line; opening it shows the whole record as JSON. */
export const LogRow = memo(function LogRow({ record, expanded, onToggle }: LogRowProps) {
  return (
    <div className="border-b font-mono text-xs" data-testid="log-row">
      <button
        type="button"
        className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-muted/50"
        aria-expanded={expanded}
        onClick={() => onToggle(record.cursor)}
      >
        <ChevronRight className={cn("size-3 shrink-0 self-center transition-transform", expanded && "rotate-90")} />
        <span className="shrink-0 text-muted-foreground">{formatTime(record.timestamp)}</span>
        <span className={cn("w-12 shrink-0 uppercase", LEVEL_STYLES[record.level])}>{record.level}</span>
        <span className="w-28 shrink-0 truncate text-muted-foreground">{record.service}</span>
        <span className={cn("min-w-0 flex-1", expanded ? "whitespace-pre-wrap break-words" : "truncate")}>
          {record.message}
        </span>
      </button>
      {expanded ? (
        <pre className="overflow-x-auto bg-muted/40 px-9 py-2">{JSON.stringify(record, null, 2)}</pre>
      ) : null}
    </div>
  );
});
