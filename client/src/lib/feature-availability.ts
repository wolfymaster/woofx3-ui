import type { EngineAvailability } from "@convex/lib/entitlementAccess";
import type { EntitlementFeatureKey } from "@convex/lib/entitlements";

/**
 * What a paid feature looks like on the current engine:
 * - available: the plan includes it
 * - upgrade: a hosted engine whose plan lacks it
 * - unavailable: a self-hosted engine, which offers no paid feature on any plan
 */
export type FeatureState = "available" | "unavailable" | "upgrade";

/** The feature's state from `entitlements.forViewer`: undefined while loading, unavailable for a non-member. */
export function featureState(
  availability: EngineAvailability | null | undefined,
  feature: EntitlementFeatureKey
): FeatureState | undefined {
  if (availability === undefined) {
    return undefined;
  }
  if (availability === null || availability.availability === "self_hosted") {
    return "unavailable";
  }
  return availability.entitlements.features.includes(feature) ? "available" : "upgrade";
}

/**
 * Whether billing UI (trial notices, banners, plan choice, the org portal)
 * may show: only for a hosted engine, and never in the desktop app.
 */
export function billingUiVisible(availability: EngineAvailability | null | undefined, isDesktop: boolean): boolean {
  return !isDesktop && availability?.availability === "hosted";
}
