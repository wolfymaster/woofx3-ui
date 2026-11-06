import { api } from "@convex/_generated/api";
import type { EngineAvailability } from "@convex/lib/entitlementAccess";
import type { EntitlementFeatureKey } from "@convex/lib/entitlements";
import { useQuery } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { IS_DESKTOP } from "@/lib/desktop";
import { billingUiVisible, featureState } from "@/lib/feature-availability";
import type { FeatureSource } from "@/lib/feature-source";

function useAvailability(): EngineAvailability | null | undefined {
  const { optimisticInstanceId } = useInstance();
  return useQuery(api.entitlements.forViewer, optimisticInstanceId ? { instanceId: optimisticInstanceId } : "skip");
}

/** The hosted app's answers, from the current engine's availability and its org's plan. */
export const hostedFeatureSource: FeatureSource = {
  useFeature: (feature: EntitlementFeatureKey) => featureState(useAvailability(), feature),
  useBilling: () => {
    const availability = useAvailability();
    return { visible: billingUiVisible(availability, IS_DESKTOP), availability };
  },
};
