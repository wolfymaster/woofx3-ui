import { BellRing, Workflow, Zap } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { Trace, TraceSpan } from "@/lib/run-trace";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/workflow-run-timeline";
import { TONE_STYLE } from "./tone-style";

interface TraceWaterfallProps {
  trace: Trace;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Every span of a run on one time axis, one row each, like the waterfall of a
 * tracing tool: where each part started, how long it took, and what overlapped.
 *
 * Rows are buttons in one tab stop; the arrow keys move the selection so the
 * details below can be walked without the mouse.
 */
export function TraceWaterfall({ trace, selectedId, onSelect }: TraceWaterfallProps) {
  const percent = (ms: number) => (ms / trace.spanMs) * 100;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const index = trace.spans.findIndex((span) => span.id === selectedId);
    const next = event.key === "ArrowDown" ? Math.min(trace.spans.length - 1, index + 1) : Math.max(0, index - 1);
    const span = trace.spans[next];
    if (span) {
      onSelect(span.id);
      document.getElementById(rowId(span.id))?.focus();
    }
  };

  return (
    <div className="overflow-x-auto" data-testid="alert-run-trace">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[10rem_1fr] border-b sm:grid-cols-[15rem_1fr]">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground">Span</div>
          {/* The right margin, here and on every track, is where a bar ending at the
              axis's end puts its duration label. */}
          <div className="relative mr-12 h-8">
            {trace.ticks.map((tick) => (
              <span
                key={tick}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground",
                  tick > 0 && "-translate-x-1/2"
                )}
                style={{ left: `${percent(tick)}%` }}
              >
                {formatDuration(tick)}
              </span>
            ))}
          </div>
        </div>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys are forwarded from the row buttons inside */}
        <div role="presentation" onKeyDown={onKeyDown}>
          {trace.spans.map((span) => (
            <SpanRow
              key={span.id}
              span={span}
              ticks={trace.ticks}
              percent={percent}
              selected={span.id === selectedId}
              onSelect={() => onSelect(span.id)}
              tabbable={span.id === selectedId || (selectedId === null && span === trace.spans[0])}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function rowId(spanId: string): string {
  return `trace-row-${spanId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

const KIND_ICON = { trigger: Zap, run: Workflow, alert: BellRing } as const;

interface SpanRowProps {
  span: TraceSpan;
  ticks: number[];
  percent: (ms: number) => number;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
}

function SpanRow({ span, ticks, percent, selected, tabbable, onSelect }: SpanRowProps) {
  const style = TONE_STYLE[span.tone];
  const KindIcon = span.kind === "step" ? style.icon : KIND_ICON[span.kind];
  const iconColor = span.kind === "trigger" ? "text-amber-500" : style.color;

  return (
    <button
      type="button"
      id={rowId(span.id)}
      onClick={onSelect}
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={selected}
      className={cn(
        "grid w-full grid-cols-[10rem_1fr] border-b text-left last:border-b-0 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[15rem_1fr]",
        selected && "bg-accent hover:bg-accent"
      )}
      data-testid={`alert-run-span-${span.id}`}
    >
      <span className="flex min-w-0 items-center gap-2 py-2 pr-2" style={{ paddingLeft: `${0.75 + span.depth}rem` }}>
        <KindIcon
          className={cn("h-3.5 w-3.5 shrink-0", iconColor, span.kind === "step" && style.spin && "animate-spin")}
        />
        <span className="min-w-0">
          <span className={cn("block truncate text-sm", span.kind === "trigger" && "font-mono text-[13px]")}>
            {span.label}
          </span>
          {span.detail && <span className="block truncate text-[11px] text-muted-foreground">{span.detail}</span>}
        </span>
      </span>

      <span className="relative mr-12 block h-full min-h-10">
        {ticks.map((tick) => (
          <span
            key={tick}
            aria-hidden
            className="absolute inset-y-0 w-px bg-border/60"
            style={{ left: `${percent(tick)}%` }}
          />
        ))}
        <SpanBar span={span} percent={percent} />
      </span>
    </button>
  );
}

function SpanBar({ span, percent }: { span: TraceSpan; percent: (ms: number) => number }) {
  const style = TONE_STYLE[span.tone];

  if (span.startMs === null) {
    return (
      <span className="absolute inset-y-0 left-2 flex items-center text-[11px] italic text-muted-foreground">
        {span.kind === "trigger" ? "not on this clock" : "not timed"}
      </span>
    );
  }

  const left = percent(span.startMs);

  // A moment rather than a stretch of time: the event that started the run.
  if (span.endMs === null && !span.open) {
    return (
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]",
          span.kind === "trigger" ? "bg-amber-500" : style.bar
        )}
        style={{ left: `${left}%` }}
      />
    );
  }

  const right = span.endMs === null ? 100 : percent(span.endMs);
  const duration = span.endMs === null ? undefined : span.endMs - span.startMs;
  const label = span.open ? "running" : formatDuration(duration);

  return (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 h-3 min-w-[3px] -translate-y-1/2 rounded-sm",
          style.bar,
          span.kind === "run" && "opacity-40",
          span.open && "animate-pulse bg-gradient-to-r from-blue-500 to-blue-500/10"
        )}
        style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
      />
      {span.marks.map((mark) => (
        <span
          key={mark.label}
          aria-hidden
          title={`${mark.label} at +${formatDuration(mark.atMs)}`}
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${percent(mark.atMs)}%` }}
        />
      ))}
      <span
        className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
        style={{ left: `calc(${right}% + 6px)` }}
      >
        {label}
      </span>
    </>
  );
}
