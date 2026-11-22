import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEngineSyncRequest, useEngineSyncState } from "@/engine/hooks/use-engine-status";
import { TRY_AGAIN } from "@/lib/copy";
import { useLogger } from "@/lib/logger-context";

export function EngineSyncCard() {
  const logger = useLogger();
  const state = useEngineSyncState();
  const syncNow = useEngineSyncRequest();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSyncNow = async () => {
    setError(null);
    setPending(true);
    try {
      const res = await syncNow();
      if (!res.scheduled) {
        setError("Already refreshing.");
      }
    } catch (e) {
      logger.error("Could not start refresh", { error: e });
      setError(TRY_AGAIN);
    } finally {
      setPending(false);
    }
  };

  if (state === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </CardContent>
      </Card>
    );
  }
  if (state === null) {
    return null;
  }

  const { syncState, currentRun, recentRuns } = state;
  const isRunning = currentRun !== null;
  const lastError = recentRuns.find((r) => r.status === "error");

  const lastSyncedLabel =
    syncState && syncState.lastSyncedAt > 0 ? `${formatDistanceToNow(new Date(syncState.lastSyncedAt))} ago` : "Never";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Refresh</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Last refreshed</div>
          <div className="mt-1 font-medium">{lastSyncedLabel}</div>
        </div>

        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSyncNow}
            disabled={isRunning || pending}
            data-testid="button-sync-now"
          >
            {isRunning || pending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {isRunning ? "Refreshing…" : "Refresh now"}
          </Button>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </div>

        {!currentRun && lastError && syncState?.status === "error" && (
          <p className="text-sm text-destructive">Couldn&apos;t refresh. We&apos;ll try again automatically.</p>
        )}
      </CardContent>
    </Card>
  );
}
