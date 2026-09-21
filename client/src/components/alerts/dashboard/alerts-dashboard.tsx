import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { BellRing, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { AlertFeed } from "@/components/alerts/dashboard/alert-feed";
import { AlertFrequencyChart } from "@/components/alerts/dashboard/alert-frequency-chart";
import { AlertStatTiles } from "@/components/alerts/dashboard/alert-stat-tiles";
import { EmptyState } from "@/components/common/empty-state";
import { TestEventPicker } from "@/components/test-events/test-event-picker";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useInstance } from "@/hooks/use-instance";
import type { AlertMenuSection } from "@/lib/alert-groups";
import { isFailureStatus } from "@/lib/alert-status";

/** How many dispatches the feed shows. Enough to cover a busy hour without paging. */
const FEED_LIMIT = 40;

interface AlertsDashboardProps {
  /** Every alert trigger, in the rail's menu order — see flattenAlertTree. */
  sections: AlertMenuSection[];
}

/**
 * What the Alerts screen shows before a kind of event is chosen: how alerts
 * have been going, what fired recently, and a way to fire one by hand.
 *
 * Reads the engine's own alert log rather than the workflow runs behind it.
 * The two answer different questions — a run can succeed while the alert it
 * published never reaches an overlay — and this page is about the second.
 */
export function AlertsDashboard({ sections }: AlertsDashboardProps) {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const overview = useQuery(api.engineAlerts.overview, instanceId ? { instanceId } : "skip");
  const alerts = useQuery(api.engineAlerts.listForInstance, instanceId ? { instanceId, limit: FEED_LIMIT } : "skip");

  const [failuresOnly, setFailuresOnly] = useState(false);
  // Null until something is picked; the first trigger stands in so the card is
  // usable the moment the page opens.
  const [testPresetId, setTestPresetId] = useState<string | null>(null);
  const selectedTestId = testPresetId ?? sections[0]?.presets[0]?.id ?? null;

  const eventNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const section of sections) {
      for (const preset of section.presets) {
        if (preset.event) {
          names.set(preset.event, preset.name);
        }
      }
    }
    return names;
  }, [sections]);

  const shown = useMemo(
    () => (alerts ?? []).filter((alert) => !failuresOnly || isFailureStatus(alert.status)),
    [alerts, failuresOnly]
  );

  if (!instanceId) {
    return (
      <EmptyState
        icon={BellRing}
        title="No instance connected"
        description="Pick an instance from the workspace switcher to see what its alerts have been doing."
      />
    );
  }

  // The query answers null only when the signed-in user may not read this
  // instance, which the workspace switcher should already prevent. Said out
  // loud rather than left as an endless skeleton, because a page that waits
  // forever is the hardest kind of broken to report.
  if (overview === null) {
    return (
      <EmptyState
        icon={BellRing}
        title="Alerts are not readable here"
        description="This account does not have access to the selected instance. Pick another from the workspace switcher."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="alerts-dashboard">
      {overview === undefined ? (
        <Skeleton className="h-[5.5rem] w-full" />
      ) : (
        <AlertStatTiles totals={overview.totals} hours={overview.hours} truncated={overview.truncated} />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Activity</h2>
              {overview?.truncated && (
                <span className="text-[11px] text-muted-foreground">showing the most recent alerts only</span>
              )}
            </div>
            {overview === undefined ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <AlertFrequencyChart buckets={overview.buckets} />
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Recent alerts</h2>
              <label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor="alert-failures-only">
                <Switch
                  id="alert-failures-only"
                  checked={failuresOnly}
                  onCheckedChange={setFailuresOnly}
                  data-testid="switch-failures-only"
                />
                Failures only
              </label>
            </div>
            {alerts === undefined ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : failuresOnly && shown.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground" data-testid="alert-feed-no-failures">
                No failures in the last {alerts.length} alerts. Nothing to diagnose.
              </p>
            ) : (
              <AlertFeed instanceId={instanceId} alerts={shown} eventNames={eventNames} />
            )}
          </Card>
        </div>

        {/* Fixed height rather than grown to fit: the form scrolls its own
            fields so the Trigger button stays on screen beside the feed,
            however many fields the chosen event declares. */}
        <Card className="flex h-[32rem] flex-col gap-4 p-4 lg:sticky lg:top-6">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Fire a test alert</h2>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Publishes a simulated event. Whatever listens for it runs exactly as it would for a real one — overlays
            included.
          </p>
          <TestEventPicker
            sections={sections}
            selectedId={selectedTestId}
            onSelect={setTestPresetId}
            id="dashboard-test-event"
          />
        </Card>
      </div>
    </div>
  );
}
