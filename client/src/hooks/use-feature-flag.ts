import { api } from "@convex/_generated/api";
import type { FeatureFlagKey } from "@convex/lib/featureFlags";
import { useQuery } from "convex/react";
import { useInstance } from "@/hooks/use-instance";

/**
 * Whether a UI feature flag is on for the signed-in user on the current
 * instance: undefined while loading. Every caller shares one subscription, so
 * a flag changed by an operator updates the page without a reload.
 */
export function useFeatureFlag(key: FeatureFlagKey): boolean | undefined {
  const { optimisticInstanceId } = useInstance();
  const flags = useQuery(api.featureFlags.forViewer, optimisticInstanceId ? { instanceId: optimisticInstanceId } : {});
  return flags === undefined ? undefined : flags[key];
}
