import { useStore } from "@nanostores/react";
import { Loader2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, Scatter, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer, ChartStyle, ChartTooltip } from "@/components/ui/chart";
import {
  type LaneItem,
  type LanePoint,
  laneAmountLabel,
  RECAP_LANE_IDS,
  RECAP_LAYER_IDS,
  RECAP_LAYER_LABELS,
  type RecapLaneId,
  type RecapLayerId,
  type RecapLayerStatus,
  timelineDomain,
} from "@/lib/recap-timeline";
import { $recapHiddenLayers } from "@/lib/stores";
import type { ViewerPoint, ViewerSeries } from "@/lib/stream-recap";
import { cn } from "@/lib/utils";

// Lanes take the categorical palette in its fixed order, skipping violet,
// which the viewers line already wears. Validated against --card in light and
// dark: the dark steps pass every check; in light, aqua, yellow and magenta sit
// under 3:1 on the surface, which the lane labels and the table view relieve,
// and the closest pair (clips and markers) is told apart by lane position and
// label as well as hue.
const chartConfig = {
  viewers: { label: "Viewers", theme: { light: "#6d28d9", dark: "#8b5cf6" } },
  follow: { label: "Follows", theme: { light: "#2a78d6", dark: "#3987e5" } },
  sub: { label: "Subs", theme: { light: "#eb6834", dark: "#d95926" } },
  giftedSubs: { label: "Gifted subs", theme: { light: "#1baf7a", dark: "#199e70" } },
  cheer: { label: "Cheers", theme: { light: "#eda100", dark: "#c98500" } },
  raid: { label: "Raids", theme: { light: "#e87ba4", dark: "#d55181" } },
  clips: { label: "Clips", theme: { light: "#008300", dark: "#008300" } },
  markers: { label: "Markers", theme: { light: "#e34948", dark: "#e66767" } },
} satisfies ChartConfig & Record<RecapLayerId, unknown>;

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** Both charts reserve the same axis width and margins, so their x scales line up exactly. */
const Y_AXIS_WIDTH = 80;
const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };
const LANE_HEIGHT = 28;
const LANE_AXIS_HEIGHT = 28;
/** Names a lane tooltip lists before summing up the rest. */
const TOOLTIP_ITEMS = 6;
/** Names a table row lists before summing up the rest. */
const TABLE_ITEMS = 20;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, TIME_FORMAT);
}

function colorVar(layer: RecapLayerId): string {
  return `var(--color-${layer})`;
}

function itemsSummary(items: ReadonlyArray<LaneItem>, limit: number): string {
  const shown = items.slice(0, limit).map((item) => (item.detail ? `${item.label} (${item.detail})` : item.label));
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest.toLocaleString()} more` : shown.join(", ");
}

interface ViewerTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: ViewerPoint }>;
}

function ViewerTooltip({ active, payload }: ViewerTooltipProps) {
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

interface LaneTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: LanePoint }>;
}

function LaneTooltip({ active, payload }: LaneTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  const amount = laneAmountLabel(point.lane, point.amount);
  const shown = point.items.slice(0, TOOLTIP_ITEMS);
  const rest = point.items.length - shown.length;
  return (
    <div className="max-w-64 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorVar(point.lane) }} aria-hidden />
        <span className="font-semibold text-foreground">
          {RECAP_LAYER_LABELS[point.lane]}
          {point.count > 1 && <span className="tabular-nums"> ×{point.count.toLocaleString()}</span>}
        </span>
        {amount && <span className="tabular-nums text-muted-foreground">{amount}</span>}
      </div>
      <div className="text-muted-foreground">{formatTime(point.t)}</div>
      <ul className="mt-1 space-y-0.5 text-foreground">
        {shown.map((item, index) => (
          // Items have no identity of their own, and their order within a point never changes.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <li key={index} className="truncate">
            {item.label}
            {item.detail && <span className="text-muted-foreground"> · {item.detail}</span>}
          </li>
        ))}
        {rest > 0 && <li className="text-muted-foreground">and {rest.toLocaleString()} more</li>}
      </ul>
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

interface LaneMarkProps {
  cx?: number;
  cy?: number;
  payload?: LanePoint;
}

/**
 * One lane point. A minute holding more moments draws a little larger, so a
 * burst reads as one at a glance; the tooltip carries the exact count. The
 * transparent ring is the hit target, wider than the mark itself.
 */
function LaneMark({ cx, cy, payload }: LaneMarkProps) {
  if (cx === undefined || cy === undefined || !payload) {
    return <g />;
  }
  const radius = Math.min(4 + Math.log2(payload.count), 8);
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={radius} fill={colorVar(payload.lane)} stroke="hsl(var(--card))" strokeWidth={2} />
    </g>
  );
}

function ViewerPlot({
  series,
  domain,
  guides,
  showAxis,
}: {
  series: ViewerSeries;
  domain: [number, number];
  guides: LanePoint[];
  showAxis: boolean;
}) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full" data-testid="chart-viewers">
      <ComposedChart data={series.points} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} strokeWidth={1} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={domain}
          allowDataOverflow
          hide={!showAxis}
          tickFormatter={formatTime}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={Y_AXIS_WIDTH}
          tickFormatter={(value: number) => value.toLocaleString()}
        />
        {guides.map((guide) => (
          <ReferenceLine
            key={`${guide.lane}-${guide.t}`}
            x={guide.t}
            stroke={colorVar(guide.lane)}
            strokeDasharray="3 3"
            strokeOpacity={0.7}
            ifOverflow="discard"
          />
        ))}
        <ChartTooltip cursor={{ strokeWidth: 1 }} content={<ViewerTooltip />} />
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
  );
}

function LanePlot({ lanes, points, domain }: { lanes: RecapLaneId[]; points: LanePoint[]; domain: [number, number] }) {
  const laneIndex = new Map(lanes.map((lane, index) => [lane, index]));
  const height = lanes.length * LANE_HEIGHT + LANE_AXIS_HEIGHT;
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto w-full"
      style={{ height }}
      data-testid="chart-recap-lanes"
    >
      <ComposedChart margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} strokeWidth={1} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={domain}
          allowDataOverflow
          tickFormatter={formatTime}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
        />
        <YAxis
          dataKey="y"
          type="number"
          domain={[-0.5, lanes.length - 0.5]}
          ticks={lanes.map((_, index) => index)}
          interval={0}
          reversed
          tickFormatter={(index: number) => RECAP_LAYER_LABELS[lanes[index]] ?? ""}
          tickLine={false}
          axisLine={false}
          width={Y_AXIS_WIDTH}
        />
        <ChartTooltip cursor={false} content={<LaneTooltip />} />
        {lanes.map((lane) => (
          <Scatter
            key={lane}
            name={RECAP_LAYER_LABELS[lane]}
            data={points
              .filter((point) => point.lane === lane)
              .map((point) => ({ ...point, y: laneIndex.get(lane) ?? 0 }))}
            fill={colorVar(lane)}
            isAnimationActive={false}
            shape={(props: LaneMarkProps) => <LaneMark {...props} />}
          />
        ))}
      </ComposedChart>
    </ChartContainer>
  );
}

function LayerToggle({
  layer,
  status,
  shown,
  onToggle,
}: {
  layer: RecapLayerId;
  status: RecapLayerStatus;
  shown: boolean;
  onToggle: () => void;
}) {
  const available = status.kind === "ready";
  const on = shown && available;
  const swatch = on ? colorVar(layer) : "hsl(var(--muted-foreground))";
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("h-7 gap-1.5 px-2 text-xs", !on && "text-muted-foreground")}
      onClick={onToggle}
      disabled={!available}
      aria-pressed={on}
      title={status.kind === "unavailable" ? status.reason : undefined}
      data-testid={`toggle-recap-layer-${layer}`}
    >
      {status.kind === "loading" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : layer === "viewers" ? (
        <span className="h-0.5 w-3 rounded-full" style={{ background: swatch }} aria-hidden />
      ) : (
        <span
          className="h-2 w-2 rounded-full border-2"
          style={{ borderColor: swatch, background: on ? swatch : "transparent" }}
          aria-hidden
        />
      )}
      {RECAP_LAYER_LABELS[layer]}
      {status.kind === "ready" && status.count !== null && (
        <span className="tabular-nums text-muted-foreground">{status.count.toLocaleString()}</span>
      )}
    </Button>
  );
}

/** Why layers are missing, one line per reason, naming the layers it applies to. */
function UnavailableNotes({ statuses }: { statuses: Record<RecapLayerId, RecapLayerStatus> }) {
  const byReason = new Map<string, RecapLayerId[]>();
  for (const layer of RECAP_LAYER_IDS) {
    const status = statuses[layer];
    if (status.kind === "unavailable") {
      byReason.set(status.reason, [...(byReason.get(status.reason) ?? []), layer]);
    }
  }
  if (byReason.size === 0) {
    return null;
  }
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="recap-layer-notes">
      {Array.from(byReason.entries()).map(([reason, layers]) => (
        <li key={reason}>
          <span className="font-medium">{layers.map((layer) => RECAP_LAYER_LABELS[layer]).join(", ")}:</span> {reason}
        </li>
      ))}
    </ul>
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

function MomentTable({ points }: { points: LanePoint[] }) {
  const ordered = [...points].sort((a, b) => a.t - b.t);
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-border" data-testid="table-recap-moments">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Minute</th>
            <th className="px-3 py-1.5 font-medium">Layer</th>
            <th className="px-3 py-1.5 font-medium">What</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((point) => {
            const amount = laneAmountLabel(point.lane, point.amount);
            return (
              <tr key={`${point.lane}-${point.t}`} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-3 py-1 tabular-nums">{formatTime(point.t)}</td>
                <td className="whitespace-nowrap px-3 py-1">
                  {RECAP_LAYER_LABELS[point.lane]}
                  {point.count > 1 && <span className="tabular-nums text-muted-foreground"> ×{point.count}</span>}
                  {amount && <span className="tabular-nums text-muted-foreground"> · {amount}</span>}
                </td>
                <td className="px-3 py-1">{itemsSummary(point.items, TABLE_ITEMS)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface RecapTimelineProps {
  series: ViewerSeries;
  points: LanePoint[];
  statuses: Record<RecapLayerId, RecapLayerStatus>;
  /** A line under the chart, such as how many events a capped list left out. */
  footnote?: string | null;
}

/**
 * The stream on one time axis, in layers: viewers per minute as a line, and
 * under it a lane per kind of moment (follows, subs, gifts, cheers, raids,
 * clips, markers). Clips and markers also cross the viewer plot as guides, so
 * a spike can be matched to what caused it. Each layer can be switched off;
 * the choice is kept per browser in `$recapHiddenLayers`.
 *
 * Minutes the engine did not sample, or failed to read, are gaps in the line
 * rather than drops to zero, so an outage in sampling is never mistaken for
 * an empty chat.
 */
export function RecapTimeline({ series, points, statuses, footnote }: RecapTimelineProps) {
  const styleId = `recap-timeline-${useId().replace(/:/g, "")}`;
  const hiddenLayers = useStore($recapHiddenLayers);
  const [showTable, setShowTable] = useState(false);
  const hidden = useMemo(() => new Set<RecapLayerId>(hiddenLayers), [hiddenLayers]);
  const hasViewerValues = useMemo(() => series.points.some((point) => point.viewers !== null), [series.points]);

  const toggle = (layer: RecapLayerId) => {
    const next = new Set(hidden);
    if (next.has(layer)) {
      next.delete(layer);
    } else {
      next.add(layer);
    }
    $recapHiddenLayers.set(RECAP_LAYER_IDS.filter((id) => next.has(id)));
  };

  const showViewers = !hidden.has("viewers") && statuses.viewers.kind === "ready" && hasViewerValues;
  const lanes = RECAP_LANE_IDS.filter((lane) => !hidden.has(lane) && statuses[lane].kind === "ready");
  const shownLanes = new Set(lanes);
  const shownPoints = points.filter((point) => shownLanes.has(point.lane));
  const guides = shownPoints.filter((point) => point.lane === "clips" || point.lane === "markers");
  const domain = timelineDomain(series.domain, points);

  return (
    <div className="space-y-3" data-chart={styleId}>
      <ChartStyle id={styleId} config={chartConfig} />
      <fieldset className="flex flex-wrap gap-1.5" aria-label="Timeline layers" data-testid="recap-layer-toggles">
        {RECAP_LAYER_IDS.map((layer) => (
          <LayerToggle
            key={layer}
            layer={layer}
            status={statuses[layer]}
            shown={!hidden.has(layer)}
            onToggle={() => toggle(layer)}
          />
        ))}
      </fieldset>
      <UnavailableNotes statuses={statuses} />

      {domain === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-recap-timeline-empty">
          Nothing to place on the timeline for this stream.
        </p>
      ) : !showViewers && lanes.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-recap-timeline-hidden">
          Every layer with something to show is switched off.
        </p>
      ) : (
        <div>
          {showViewers && <ViewerPlot series={series} domain={domain} guides={guides} showAxis={lanes.length === 0} />}
          {lanes.length > 0 && <LanePlot lanes={lanes} points={shownPoints} domain={domain} />}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="text-recap-timeline-footnote">
          {footnote}
        </p>
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
      {showTable && (
        <div className="space-y-3">
          {showViewers && <SampleTable points={series.points} />}
          {shownPoints.length > 0 && <MomentTable points={shownPoints} />}
        </div>
      )}
    </div>
  );
}
