import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { buildDashboardPreset, PRESET_LAYOUT_ID } from "@convex/lib/setupInterests";
import type { SetupStatus } from "@convex/setup";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { columnWeight, getDashboardLayout } from "@/lib/dashboard-layouts";
import { getDashboardWidget } from "@/lib/dashboard-widgets/registry";

interface DashboardStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
  onContinue: () => void;
}

/**
 * Previews the first dashboard panel built from the interests, and finishes
 * setup. The panel is only a starting point: widgets can be added, moved and
 * removed from the dashboard afterwards.
 */
export function DashboardStep({ instanceId, status, onContinue }: DashboardStepProps) {
  const complete = useMutation(api.setup.complete);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const layout = getDashboardLayout(PRESET_LAYOUT_ID);
  const widgets = buildDashboardPreset(status.interests);
  const row = layout?.rows[0];

  async function handleContinue() {
    setError(null);
    setSaving(true);
    try {
      await complete({ instanceId });
      onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Here&apos;s a dashboard to start from, based on what you picked. You can rearrange it any time.
      </p>

      {row && (
        <div className="flex gap-2 rounded-lg border bg-muted/30 p-2" data-testid="preview-setup-dashboard">
          {Array.from({ length: row.columns }, (_, column) => {
            const zoneId = `0-${column}`;
            const zoneWidgets = widgets.filter((widget) => widget.zoneId === zoneId);
            return (
              <div key={zoneId} className="flex min-w-0 flex-col gap-2" style={{ flexGrow: columnWeight(row, column) }}>
                {zoneWidgets.map((widget) => {
                  const definition = getDashboardWidget(widget.type);
                  const Icon = definition?.icon;
                  return (
                    <div
                      key={widget.slotId}
                      className="flex min-h-12 flex-1 items-center gap-1.5 rounded-md border bg-card px-2 py-2 text-xs"
                    >
                      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{definition?.label ?? widget.type}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        className="w-full"
        onClick={() => void handleContinue()}
        disabled={saving}
        data-testid="button-dashboard-continue"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Use this dashboard
      </Button>
    </div>
  );
}
