import { cn } from "@/lib/utils";

export interface AlertBucket {
  /** Start of the hour this bucket covers, in epoch milliseconds. */
  start: number;
  total: number;
  failed: number;
}

interface AlertFrequencyChartProps {
  buckets: AlertBucket[];
}

const hourLabel = (start: number) =>
  new Date(start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * One bar per hour: how many alerts fired, and how many of them failed.
 *
 * Drawn from divs rather than a charting library because the whole chart is
 * twenty-four values with no axes, no zoom and no legend — a dependency would
 * cost more to read than the twenty lines it replaced.
 *
 * Every bar keeps its full-height track even at zero, so a quiet hour reads as
 * a gap in a row of slots rather than as the chart ending early.
 */
export function AlertFrequencyChart({ buckets }: AlertFrequencyChartProps) {
  if (buckets.length === 0) {
    return null;
  }

  const peak = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const busiest = buckets.reduce((best, bucket) => (bucket.total > best.total ? bucket : best), buckets[0]);

  return (
    <div className="space-y-2" data-testid="alert-frequency-chart">
      <div
        className="flex h-24 items-end gap-[3px]"
        role="img"
        aria-label={
          total === 0
            ? "No alerts in this window"
            : `${total} alerts, peaking at ${peak} in the hour from ${hourLabel(busiest.start)}`
        }
      >
        {buckets.map((bucket) => {
          const played = bucket.total - bucket.failed;
          const fill = (bucket.total / peak) * 100;
          return (
            <div
              key={bucket.start}
              className="relative h-full flex-1 overflow-hidden rounded-sm bg-muted/50"
              title={`${hourLabel(bucket.start)} — ${bucket.total} ${bucket.total === 1 ? "alert" : "alerts"}${
                bucket.failed > 0 ? `, ${bucket.failed} failed` : ""
              }`}
              data-testid={`alert-frequency-bucket-${bucket.start}`}
            >
              <div className="absolute inset-x-0 bottom-0 flex flex-col" style={{ height: `${fill}%` }}>
                <div
                  className={cn("w-full bg-primary", bucket.failed === 0 && "rounded-t-sm")}
                  style={{ height: `${bucket.total === 0 ? 0 : (played / bucket.total) * 100}%` }}
                />
                <div
                  className={cn("w-full bg-red-500", played === 0 && "rounded-t-sm")}
                  style={{ height: `${bucket.total === 0 ? 0 : (bucket.failed / bucket.total) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{hourLabel(buckets[0].start)}</span>
        <span>
          {total} in {buckets.length}h · peak {peak}/h
        </span>
        <span>now</span>
      </div>
    </div>
  );
}
