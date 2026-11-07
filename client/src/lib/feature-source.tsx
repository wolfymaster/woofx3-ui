import type { EngineAvailability } from "@convex/lib/entitlementAccess";
import type { EntitlementFeatureKey } from "@convex/lib/entitlements";
import { createContext, type ReactNode, useContext } from "react";
import type { FeatureState } from "@/lib/feature-availability";

// Where paid-feature answers come from in one mode of the app. The hosted app
// asks Convex; the desktop app's local mode has no Convex and no plan, so
// every paid feature is unavailable there. Each app root mounts its source.

export interface FeatureSource {
  /** A hook: the feature's state on the current engine, undefined while loading. */
  useFeature: (feature: EntitlementFeatureKey) => FeatureState | undefined;
  /** A hook: whether billing UI may show, and the engine's availability it was judged on. */
  useBilling: () => { visible: boolean; availability: EngineAvailability | null | undefined };
}

const FeatureSourceContext = createContext<FeatureSource | null>(null);

export function FeatureSourceProvider({ source, children }: { source: FeatureSource; children: ReactNode }) {
  return <FeatureSourceContext.Provider value={source}>{children}</FeatureSourceContext.Provider>;
}

function useFeatureSource(): FeatureSource {
  const source = useContext(FeatureSourceContext);
  if (source === null) {
    throw new Error("useFeature needs a FeatureSourceProvider above it");
  }
  return source;
}

export function useFeature(feature: EntitlementFeatureKey): FeatureState | undefined {
  return useFeatureSource().useFeature(feature);
}

export function useBillingUi(): { visible: boolean; availability: EngineAvailability | null | undefined } {
  return useFeatureSource().useBilling();
}
