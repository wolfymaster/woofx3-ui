import { v } from "convex/values";

/** What applying the default seed has done so far; see convex/defaultSeed.ts. */
export const defaultSeedValidator = v.object({
  scene: v.object({
    status: v.union(v.literal("installed"), v.literal("pending"), v.literal("failed")),
    engineSceneId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  alerts: v.array(
    v.object({
      itemId: v.string(),
      status: v.union(v.literal("installed"), v.literal("pending"), v.literal("failed")),
      error: v.optional(v.string()),
    })
  ),
  // Whether the module had the images when the alerts were seeded.
  alertImages: v.optional(v.union(v.literal("included"), v.literal("omitted"))),
});
