import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { CreditCard } from "lucide-react";
import { Link } from "wouter";
import { useInstance } from "@/hooks/use-instance";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { useBillingUi } from "@/lib/feature-source";

const BILLING_PATH = "/org/billing";

function day(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A strip under the shell header near the end of a trial and while a payment
 * is needed. Only the owner gets the link to Billing; everyone else sees the
 * date. Never on a self-hosted engine or in the desktop app.
 */
export function BillingBanner() {
  const { visible } = useBillingUi();
  const { optimisticInstanceId } = useInstance();
  const now = useMinuteClock();
  const banner = useQuery(
    api.billing.bannerForViewer,
    visible && optimisticInstanceId ? { instanceId: optimisticInstanceId, now } : "skip"
  );
  if (!visible || !banner) {
    return null;
  }
  const message =
    banner.kind === "trial_ending"
      ? `Your trial ends ${day(banner.dateIso)}.`
      : `Payment needed by ${day(banner.dateIso)}, or hosted engines will be paused.`;
  return (
    <div
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm shrink-0"
      data-testid={`banner-billing-${banner.kind}`}
    >
      <CreditCard className="h-4 w-4 shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1">
        {message}
        {banner.canManageBilling ? (
          <>
            {" "}
            <Link href={BILLING_PATH} className="underline underline-offset-2">
              {banner.kind === "trial_ending" ? "Add a payment method" : "Manage billing"}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
