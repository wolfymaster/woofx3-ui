import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { recordMarketplaceInstall } from "./lib/marketplaceInstallRecords";

/**
 * Records the listing and edition a marketplace install is for, by the key it
 * installs under. Called by both install paths once the key is known: before
 * the engine is asked on the Convex path, after it answers on the engine path.
 */
export const record = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleKey: v.string(),
    listingId: v.string(),
    edition: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await recordMarketplaceInstall(ctx, args);
  },
});
