import type { FeatureSource } from "@/lib/feature-source";

/** Local mode runs its own engine with no plan: no paid feature, and never billing. */
export const localFeatureSource: FeatureSource = {
  useFeature: () => "unavailable",
  useBilling: () => ({ visible: false, availability: undefined }),
};
