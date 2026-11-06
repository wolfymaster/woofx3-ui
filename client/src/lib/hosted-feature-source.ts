import { api } from "@convex/_generated/api";
import type { EngineAvailability } from "@convex/lib/entitlementAccess";
import type { EntitlementFeatureKey } from "@convex/lib/entitlements";
import { useQuery } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { IS_DESKTOP } from "@/lib/desktop";
import { billingUiVisible, featureState } from "@/lib/feature-availability";
import type { FeatureSource } from "@/lib/feature-source";

function useAvailability(): EngineAvailability | null | undefined {
  const { optimisticInstanceId } = useInstance();
  // A query doesn't re-run as time passes; the clock lets an expiring override lapse on screen.
  const now = useMinuteClock();
  return useQuery(
    api.entitlements.forViewer,
    optimisticInstanceId ? { instanceId: optimisticInstanceId, now } : "skip"
  );
}

/** The hosted app's answers, from the current engine's availability and its org's plan. */
export const hostedFeatureSource: FeatureSource = {
  useFeature: (feature: EntitlementFeatureKey) => featureState(useAvailability(), feature),
  useBilling: () => {
    const availability = useAvailability();
    return { visible: billingUiVisible(availability, IS_DESKTOP), availability };
  },
};
