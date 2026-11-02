import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { engineBuildStalled } from "@convex/lib/firstRun";
import { useAction, useQuery } from "convex/react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useMinuteClock } from "@/hooks/use-minute-clock";

const HEADLINES: Record<string, string> = {
  requested: "Getting started on your setup…",
  provisioning: "Setting things up for you…",
  ready: "Almost there…",
  registering: "Almost there…",
  registered: "You're all set up",
  failed: "We couldn't finish setting up",
  deprovisioning: "Removing your setup…",
  deleted: "Your setup was removed",
};

/**
 * A one-line summary of a managed engine being built, shown above setup so the
 * user can carry on while it runs. Written for someone who does not know there
 * is an engine: the run's steps and raw errors live on the admin engine page.
 * Renders nothing for an engine this app did not build.
 */
export function ProvisioningBar({ instanceId }: { instanceId: Id<"instances"> }) {
  const provisioning = useQuery(api.provisioning.forInstance, { instanceId });
  const retry = useAction(api.provisioning.retry);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const now = useMinuteClock();

  if (!provisioning) {
    return null;
  }

  // A request that died never reports failing, so the row's age has to say it.
  const isFailed = engineBuildStalled({ provisioning, managedEngine: true, completedAt: null, now });
  const isDone = provisioning.status === "registered";
  const steps = provisioning.steps;
  const doneSteps = steps.filter((step) => step.status === "succeeded" || step.status === "skipped").length;
  const percent = isDone ? 100 : steps.length === 0 ? 5 : Math.max(5, Math.round((doneSteps / steps.length) * 100));

  async function handleRetry() {
    setRetryFailed(false);
    setRetrying(true);
    try {
      await retry({ instanceId });
    } catch (err) {
      console.error("[provisioning-bar] retry failed", String(err));
      setRetryFailed(true);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-2" data-testid="provisioning-bar">
      <div className="flex items-center gap-2 text-sm">
        {isFailed ? (
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
        ) : isDone ? (
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        )}
        <output className="font-medium flex-1" aria-live="polite" data-testid="text-provisioning-bar-status">
          {isFailed ? HEADLINES.failed : (HEADLINES[provisioning.status] ?? "Setting things up for you…")}
        </output>
        {isFailed && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            disabled={retrying}
            data-testid="button-provisioning-bar-retry"
          >
            {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Try again
          </Button>
        )}
      </div>
      {!isFailed && <Progress value={percent} className="h-1.5" />}
      {isFailed && <p className="text-xs text-muted-foreground">This usually clears up with a retry.</p>}
      {retryFailed && <p className="text-xs text-destructive">That didn&apos;t work. Try again in a moment.</p>}
      {!isFailed && !isDone && <p className="text-xs text-muted-foreground">It keeps going if you close this tab.</p>}
    </div>
  );
}
