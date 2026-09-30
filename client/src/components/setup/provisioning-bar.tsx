import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { ProvisioningSteps } from "@/components/engine/provisioning-steps";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";

const HEADLINES: Record<string, string> = {
  requested: "Asking for your engine…",
  provisioning: "Building your engine…",
  ready: "Your engine is up",
  registering: "Connecting your dashboard to your engine…",
  registered: "Your engine is ready",
  failed: "Your engine could not be set up",
  deprovisioning: "Deleting this engine…",
  deleted: "This engine was deleted",
};

/**
 * A one-line summary of a managed engine being built, shown above the setup
 * wizard so the user can carry on while it runs. Renders nothing for an
 * engine this app did not build.
 */
export function ProvisioningBar({ instanceId }: { instanceId: Id<"instances"> }) {
  const provisioning = useQuery(api.provisioning.forInstance, { instanceId });
  const retry = useAction(api.provisioning.retry);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (!provisioning) {
    return null;
  }

  const isFailed = provisioning.status === "failed";
  const isDone = provisioning.status === "registered";
  const steps = provisioning.steps;
  const doneSteps = steps.filter((step) => step.status === "succeeded" || step.status === "skipped").length;
  const percent = isDone ? 100 : steps.length === 0 ? 5 : Math.max(5, Math.round((doneSteps / steps.length) * 100));

  async function handleRetry() {
    setRetryError(null);
    setRetrying(true);
    try {
      await retry({ instanceId });
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
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
        <span className="font-medium flex-1" data-testid="text-provisioning-bar-status">
          {HEADLINES[provisioning.status] ?? provisioning.status}
        </span>
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
      {isFailed && provisioning.error && (
        <p className="text-xs text-destructive/90 break-words">{provisioning.error}</p>
      )}
      {retryError && <p className="text-xs text-destructive">{retryError}</p>}
      {!isFailed && !isDone && (
        <p className="text-xs text-muted-foreground">This takes a few minutes. Keep going with setup meanwhile.</p>
      )}
      {steps.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            Details
            <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <ProvisioningSteps steps={steps} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
