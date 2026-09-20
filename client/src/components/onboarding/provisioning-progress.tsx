import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { engineHostname } from "@/lib/engine-slug";
import { $currentInstanceId } from "@/lib/stores";

interface ProvisioningProgressProps {
  instanceId: Id<"instances">;
}

type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "succeeded") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  }
  if (status === "failed") {
    return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  }
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />;
  }
  if (status === "skipped") {
    return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

/** What the user is told is happening, per row status. */
const HEADLINES: Record<string, string> = {
  requested: "Asking for your engine…",
  provisioning: "Building your engine",
  ready: "Your engine is up",
  registering: "Connecting your dashboard…",
  registered: "Ready",
  failed: "Something went wrong",
  deprovisioning: "Deleting this engine…",
  deleted: "This engine was deleted",
};

/**
 * Live progress for a managed engine being built.
 *
 * Everything shown comes from the provisioning row, which the maintenance
 * API's callbacks keep current — so this polls nothing, and reloading the page
 * mid-provision lands right back here rather than losing the run.
 */
export function ProvisioningProgress({ instanceId }: ProvisioningProgressProps) {
  const provisioning = useQuery(api.provisioning.forInstance, { instanceId });
  const retry = useAction(api.provisioning.retry);
  const [, navigate] = useLocation();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const status = provisioning?.status;

  // The engine answered the handshake, so the rest of the app has something to
  // talk to: make it the selected instance and leave onboarding.
  useEffect(() => {
    if (status !== "registered") {
      return;
    }
    $currentInstanceId.set(instanceId);
    navigate("/");
  }, [status, instanceId, navigate]);

  if (provisioning === undefined) {
    return (
      <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }
  if (provisioning === null) {
    return <p className="py-6 text-sm text-muted-foreground">No engine is being created for this workspace.</p>;
  }

  const hostname = engineHostname(provisioning.slug);
  const isFailed = provisioning.status === "failed";

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
    <div className="space-y-4" data-testid="provisioning-progress">
      <div>
        <p className="font-medium" data-testid="text-provisioning-status">
          {HEADLINES[provisioning.status] ?? provisioning.status}
        </p>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">{provisioning.publicUrl ?? hostname}</p>
      </div>

      {provisioning.steps.length > 0 && (
        <ul className="space-y-1.5 text-sm" data-testid="list-provisioning-steps">
          {provisioning.steps.map((step) => (
            <li key={step.key} className="flex items-start gap-2">
              <span className="mt-0.5">
                <StepIcon status={step.status} />
              </span>
              <span className="min-w-0">
                <span className={step.status === "failed" ? "text-destructive" : undefined}>{step.label}</span>
                {step.error && <span className="block text-xs text-destructive break-words">{step.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Registration has no steps of its own: it is one handshake, retried on
          a backoff, so its state is the row's rather than a list entry. */}
      {provisioning.status === "registering" && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Registering the dashboard with your engine
        </p>
      )}

      {isFailed && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <p className="text-xs text-destructive/90 break-words" data-testid="text-provisioning-error">
            {provisioning.error ?? "The engine could not be created."}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            disabled={retrying}
            data-testid="button-retry-provisioning"
          >
            {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Try again
          </Button>
          {retryError && <p className="text-xs text-destructive">{retryError}</p>}
        </div>
      )}

      {provisioning.status !== "failed" && provisioning.status !== "registered" && (
        <p className="text-xs text-muted-foreground">
          This takes a few minutes. You can leave this page open — it updates itself.
        </p>
      )}
    </div>
  );
}
