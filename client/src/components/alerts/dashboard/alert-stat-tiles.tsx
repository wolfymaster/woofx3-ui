import { Activity, AlertCircle, CheckCircle2, type LucideIcon, Percent } from "lucide-react";
import { Card } from "@/components/ui/card";
import { successRate } from "@/lib/alert-status";
import { cn } from "@/lib/utils";

export interface AlertTotals {
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
  skipped: number;
  replayed: number;
}

interface AlertStatTilesProps {
  totals: AlertTotals;
  hours: number;
  /** The window held more alerts than the overview counted; see convex/engineAlerts.ts. */
  truncated: boolean;
}

/** The four numbers worth reading before anything else on the page. */
export function AlertStatTiles({ totals, hours, truncated }: AlertStatTilesProps) {
  const rate = successRate(totals);
  const settled = totals.completed + totals.failed;
  const window = hours === 24 ? "last 24 hours" : `last ${hours} hours`;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="alert-stat-tiles">
      <Tile
        icon={Activity}
        label="Alerts"
        value={truncated ? `${totals.total}+` : totals.total}
        detail={totals.inFlight > 0 ? `${totals.inFlight} still in flight` : window}
        testId="alert-stat-total"
      />
      <Tile icon={CheckCircle2} label="Played" value={totals.completed} detail={window} testId="alert-stat-played" />
      <Tile
        icon={AlertCircle}
        label="Failed"
        value={totals.failed}
        detail={totals.skipped > 0 ? `${totals.skipped} skipped` : window}
        tone={totals.failed > 0 ? "bad" : undefined}
        testId="alert-stat-failed"
      />
      <Tile
        icon={Percent}
        label="Success rate"
        // An alert that has not settled is not yet a success or a failure, so
        // the rate describes only those that have — and says how many that is,
        // because "100%" off one alert should not read like "100%" off ninety.
        value={rate === null ? "—" : `${Math.round(rate * 100)}%`}
        detail={settled === 0 ? "nothing settled yet" : `of ${settled} settled`}
        tone={rate !== null && rate < 0.9 ? "bad" : undefined}
        testId="alert-stat-rate"
      />
    </div>
  );
}

interface TileProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  detail: string;
  tone?: "bad";
  testId: string;
}

function Tile({ icon: Icon, label, value, detail, tone, testId }: TileProps) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", tone === "bad" && "text-red-500")} />
        {label}
      </div>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "bad" && "text-red-500")}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
