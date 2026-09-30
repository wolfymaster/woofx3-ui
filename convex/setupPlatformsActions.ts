"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { type ResolvedSetupPlatforms, resolveSetupPlatforms } from "./lib/setupPlatforms";
import { logger } from "./logger";
import { fetchMarketplaceArchivePermissions, fetchMarketplaceDownload, fetchMarketplaceListing } from "./marketplace";

/**
 * The platforms to offer while setting up an instance, with the permissions
 * each one's current marketplace build declares. Choosing a platform approves
 * exactly those permissions, and the later install refuses a build that asks
 * for more.
 *
 * Throws when the marketplace listing itself cannot be read: setup cannot
 * offer anything without it, and an empty list would look like a finished one.
 */
export const listForSetup = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ResolvedSetupPlatforms> => {
    await requireInstanceRoleInAction(ctx, instanceId);

    const [curated, listing] = await Promise.all([
      ctx.runQuery(internal.setupPlatforms.listCurated, {}),
      fetchMarketplaceListing(),
    ]);
    const listedIds = new Set(listing.map((entry) => entry.id));

    const permissionsById = new Map<string, string[] | null>(
      await Promise.all(
        curated
          .filter((entry) => listedIds.has(entry.marketplaceModuleId))
          .map(async (entry): Promise<[string, string[] | null]> => {
            try {
              const download = await fetchMarketplaceDownload(entry.marketplaceModuleId);
              return [entry.marketplaceModuleId, await fetchMarketplaceArchivePermissions(download)];
            } catch (err) {
              logger.warn("could not read setup platform permissions", {
                marketplaceModuleId: entry.marketplaceModuleId,
                error: err instanceof Error ? err.message : String(err),
              });
              return [entry.marketplaceModuleId, null];
            }
          })
      )
    );

    return resolveSetupPlatforms(curated, listing, permissionsById);
  },
});
