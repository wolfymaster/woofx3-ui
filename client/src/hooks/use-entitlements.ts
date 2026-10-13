import { api } from "@convex/_generated/api";
import type { EntitlementFeatureKey, Entitlements } from "@convex/lib/entitlements";
import { useQuery } from "convex/react";
import { useInstance } from "@/hooks/use-instance";

/**
 * The current instance's account entitlements: undefined while loading or
 * with no instance chosen, null when the viewer is not a member of it.
 */
export function useEntitlements(): Entitlements | null | undefined {
  const { optimisticInstanceId } = useInstance();
  return useQuery(api.entitlements.forViewer, optimisticInstanceId ? { instanceId: optimisticInstanceId } : "skip");
}

/** Whether the current account's plan includes a feature: undefined while loading. */
export function useEntitlement(feature: EntitlementFeatureKey): boolean | undefined {
  const entitlements = useEntitlements();
  if (entitlements === undefined) {
    return undefined;
  }
  if (entitlements === null) {
    return false;
  }
  return entitlements.features.includes(feature);
}
