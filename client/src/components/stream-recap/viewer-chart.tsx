import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { ViewerPoint, ViewerSeries } from "@/lib/stream-recap";

// Both steps are validated for the chart surfaces in index.css (--card, light
// and dark): inside the mark lightness band and above 3:1 contrast.
const chartConfig = {
  viewers: { label: "Viewers", theme: { light: "#6d28d9", dark: "#8b5cf6" } },
} satisfies ChartConfig;

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, TIME_FORMAT);
}

interface TooltipBodyProps {
  active?: boolean;
  payload?: Array<{ payload?: ViewerPoint }>;
}

function TooltipBody({ active, payload }: TooltipBodyProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  return (
    <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3 rounded-full bg-[--color-viewers]" aria-hidden />
        <span className="font-semibold tabular-nums text-foreground">
          {point.viewers === null ? "Not sampled" : point.viewers.toLocaleString()}
        </span>
      </div>
      <div className="text-muted-foreground">{formatTime(point.t)}</div>
    </div>
  );
}

interface IsolatedDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: ViewerPoint;
}

/**
 * A lone sampled minute between gaps has no neighbour to draw a line to, so it
 * gets a marker; every other point stays unmarked to keep the line thin.
 */
function IsolatedDot({ cx, cy, index, payload }: IsolatedDotProps) {
  if (!payload?.isolated || cx === undefined || cy === undefined) {
    return <g key={`dot-${index}`} />;
  }
  return (
    <circle
      key={`dot-${index}`}
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--color-viewers)"
      stroke="hsl(var(--card))"
      strokeWidth={2}
    />
  );
}

function SampleTable({ points }: { points: ViewerPoint[] }) {
  const sampled = points.filter((point) => point.viewers !== null);
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Minute</th>
            <th className="px-3 py-1.5 text-right font-medium">Viewers</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {sampled.map((point) => (
            <tr key={point.t} className="border-t border-border">
              <td className="px-3 py-1">{formatTime(point.t)}</td>
              <td className="px-3 py-1 text-right">{point.viewers?.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Viewers per sampled minute. Minutes the engine did not sample, or failed to
 * read, are gaps in the line rather than drops to zero, so an outage in
 * sampling is never mistaken for an empty chat.
 */
export function ViewerChart({ series }: { series: ViewerSeries }) {
  const [showTable, setShowTable] = useState(false);
  const hasValues = useMemo(() => series.points.some((point) => point.viewers !== null), [series.points]);

  if (!hasValues || series.domain === null) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-viewer-chart-empty">
        No viewer counts were sampled during this stream.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full" data-testid="chart-viewers">
        <ComposedChart data={series.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeWidth={1} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={series.domain}
            tickFormatter={formatTime}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => value.toLocaleString()}
          />
          <ChartTooltip cursor={{ strokeWidth: 1 }} content={<TooltipBody />} />
          <Area
            dataKey="viewers"
            type="linear"
            fill="var(--color-viewers)"
            fillOpacity={0.1}
            stroke="none"
            connectNulls={false}
            isAnimationActive={false}
            activeDot={false}
          />
          <Line
            dataKey="viewers"
            type="linear"
            stroke="var(--color-viewers)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            connectNulls={false}
            isAnimationActive={false}
            dot={(props: IsolatedDotProps) => <IsolatedDot {...props} />}
            activeDot={{ r: 4, stroke: "hsl(var(--card))", strokeWidth: 2 }}
          />
        </ComposedChart>
      </ChartContainer>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTable((shown) => !shown)}
          aria-expanded={showTable}
          data-testid="button-viewer-table"
        >
          {showTable ? "Hide table" : "Show as table"}
        </Button>
      </div>
      {showTable && <SampleTable points={series.points} />}
    </div>
  );
}
