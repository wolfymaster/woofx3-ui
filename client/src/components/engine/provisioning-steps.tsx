import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";

/** The maintenance API's step statuses, as the provisioning row stores them. */
export type ProvisioningStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface ProvisioningStep {
  key: string;
  label: string;
  status: ProvisioningStepStatus;
  error?: string;
}

export function ProvisioningStepIcon({ status }: { status: ProvisioningStepStatus }) {
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

/**
 * What the maintenance API is doing, step by step. Shared by onboarding and
 * the admin page: the same run is worth reading in both places, and a failure
 * is only legible next to the step it happened on.
 */
export function ProvisioningSteps({ steps }: { steps: readonly ProvisioningStep[] }) {
  if (steps.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1.5 text-sm" data-testid="list-provisioning-steps">
      {steps.map((step) => (
        <li key={step.key} className="flex items-start gap-2">
          <span className="mt-0.5">
            <ProvisioningStepIcon status={step.status} />
          </span>
          <span className="min-w-0">
            <span className={step.status === "failed" ? "text-destructive" : undefined}>{step.label}</span>
            {step.error && <span className="block text-xs text-destructive break-words">{step.error}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
