import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SetupStatus } from "@convex/setup";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { SetupImportPanel } from "@/components/setup-import/setup-import-panel";
import { Button } from "@/components/ui/button";

interface ImportStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
  onContinue: () => void;
}

/**
 * Offers to bring the streamer's setup over from Firebot or Streamer.bot. An
 * import chosen here is reviewed now and created once setup has installed the
 * platforms it needs, so the streamer goes live with what they already had.
 */
export function ImportStep({ instanceId, status, onContinue }: ImportStepProps) {
  const chooseImport = useMutation(api.setup.chooseImport);
  const latest = useQuery(api.setupImports.latest, { instanceId });
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next() {
    setError(null);
    setSaving(true);
    try {
      await chooseImport({ instanceId });
      onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (latest === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const queued = latest !== null && latest.status !== "review";
  if (!importing && latest === null) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Coming from Firebot or Streamer.bot? Bring your commands, alerts, timers, counters and roles with you. You see
          what comes over, and anything that can&apos;t, before it is created.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setImporting(true)} data-testid="button-setup-import">
            Import my setup
          </Button>
          <Button
            variant="outline"
            onClick={() => void next()}
            disabled={saving}
            data-testid="button-setup-import-skip"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Skip
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SetupImportPanel instanceId={instanceId} canImport={status.canManageSetup} />
      {queued && (
        <p className="text-sm text-muted-foreground">
          Your setup is created once setup finishes installing your platforms. Since you are bringing your own, you can
          skip the starter packs on the next step.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void next()} disabled={saving} data-testid="button-setup-import-continue">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {queued ? "Continue" : "Skip importing"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
