import type { EntitlementFeatureKey } from "@convex/lib/entitlements";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { IS_DESKTOP } from "@/lib/desktop";
import { useFeature } from "@/lib/feature-source";

/** The org portal's billing screen. */
const BILLING_PATH = "/org/billing";

interface PaidFeatureProps {
  feature: EntitlementFeatureKey;
  children: ReactNode;
  /**
   * Keep the slot on a self-hosted engine with a plain note instead of hiding
   * it, for places where an empty gap would read as broken.
   */
  keepSlot?: boolean;
}

/**
 * The one way UI gates a paid feature. Available: the children. A hosted
 * plan without it: a note pointing at Billing (plain text in the desktop
 * app, which never shows billing). Self-hosted: nothing, or with `keepSlot`
 * a note with no link, price or trial.
 */
export function PaidFeature({ feature, children, keepSlot = false }: PaidFeatureProps) {
  const state = useFeature(feature);
  switch (state) {
    case undefined:
      return null;
    case "available":
      return <>{children}</>;
    case "upgrade":
      return (
        <p className="text-sm text-muted-foreground" data-testid={`paid-feature-upgrade-${feature}`}>
          {IS_DESKTOP ? (
            "Not on your plan"
          ) : (
            <>
              Not on your plan. <Link href={BILLING_PATH}>See plans</Link>
            </>
          )}
        </p>
      );
    case "unavailable":
      return keepSlot ? (
        <p className="text-sm text-muted-foreground" data-testid={`paid-feature-unavailable-${feature}`}>
          Available on hosted engines
        </p>
      ) : null;
  }
}
