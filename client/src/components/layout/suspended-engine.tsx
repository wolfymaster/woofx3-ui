import type { DashboardEntry } from "@convex/access";
import type { LifecycleReason } from "@convex/lib/billingLifecycle";
import { PauseCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { IS_DESKTOP } from "@/lib/desktop";

const BILLING_PATH = "/org/billing";

const REASON_TEXT: Record<LifecycleReason, string> = {
  no_payment_method: "The trial ended without a payment method.",
  payment_failed: "A payment didn't go through.",
  subscription_canceled: "The subscription was cancelled.",
  provider_ended: "The subscription ended.",
  operator: "woofx3 support paused it.",
};

/**
 * The whole content area while a hosted engine's organization is suspended.
 * The owner can reactivate from Billing; everyone else is told who can. The
 * desktop app never shows billing, so there it only explains.
 */
export function SuspendedEngine({ entry }: { entry: Extract<DashboardEntry, { kind: "suspended" }> }) {
  const owner = entry.ownerName ?? "the organization's owner";
  return (
    <div className="max-w-lg mx-auto p-6">
      <div className="rounded-md border p-6 space-y-4" data-testid="screen-engine-suspended">
        <div className="flex gap-3">
          <PauseCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">This engine's subscription isn't active</p>
            <p className="text-muted-foreground">{REASON_TEXT[entry.reason]}</p>
            {!entry.canManageBilling && (
              <p className="text-muted-foreground">Ask the owner, {owner}, to reactivate it.</p>
            )}
          </div>
        </div>
        {entry.canManageBilling && !IS_DESKTOP && (
          <Button asChild className="w-full" data-testid="button-reactivate">
            <Link href={BILLING_PATH}>Reactivate</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
