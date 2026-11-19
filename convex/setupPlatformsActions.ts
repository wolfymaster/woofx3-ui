"use node";

import type { LocalEndpointSummary } from "@shared/local-endpoints";
import { listingDeclarations, type ManifestDeclarations } from "@shared/module-detail";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { NO_SETUP_PLATFORMS_MESSAGE, type ResolvedSetupPlatforms, resolveSetupPlatforms } from "./lib/setupPlatforms";
import { logger } from "./logger";
import { fetchMarketplaceListing, marketplaceAccessForInstance, marketplaceFetch } from "./marketplace";

/**
 * The platforms to offer while setting up an instance, with the permissions
 * and local endpoints each one's current marketplace build declares. Choosing
 * a platform approves exactly those, and the later install refuses a build
 * that asks for more.
 *
 * They are read from each listing's detail, so nothing is downloaded before
 * the platform is claimed.
 *
 * Throws when the curated list is empty or the marketplace listing cannot be
 * read: setup cannot offer anything without them, and an empty list would look
 * like a finished one.
 */
export const listForSetup = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ResolvedSetupPlatforms> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const access = await marketplaceAccessForInstance(ctx, instanceId);

    const [curated, listing] = await Promise.all([
      ctx.runQuery(internal.setupPlatforms.listCurated, {}),
      fetchMarketplaceListing(access),
    ]);
    if (curated.length === 0) {
      logger.error("setupPlatforms is empty; run setupPlatforms:seedDefaults");
      throw new Error(NO_SETUP_PLATFORMS_MESSAGE);
    }
    const listedIds = new Set(listing.map((entry) => entry.id));

    const reviews = await Promise.all(
      curated
        .filter((entry) => listedIds.has(entry.marketplaceModuleId))
        .map(async (entry): Promise<[string, ManifestDeclarations | null]> => {
          const id = entry.marketplaceModuleId;
          try {
            return [id, listingDeclarations(await marketplaceFetch(`/modules/${encodeURIComponent(id)}`, access))];
          } catch (err) {
            logger.warn("could not read setup platform permissions", {
              marketplaceModuleId: id,
              error: err instanceof Error ? err.message : String(err),
            });
            return [id, null];
          }
        })
    );
    const permissionsById = new Map<string, string[] | null>(
      reviews.map(([id, review]) => [id, review?.permissions ?? null])
    );
    const localEndpointsById = new Map<string, LocalEndpointSummary[]>(
      reviews.map(([id, review]) => [id, review?.localEndpoints ?? []])
    );

    return resolveSetupPlatforms(curated, listing, permissionsById, localEndpointsById);
  },
});
