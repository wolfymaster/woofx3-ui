"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { type LocalEndpointSummary, localEndpointSummaries } from "./lib/localEndpoints";
import { parseManifestPermissions } from "./lib/modulePermissions";
import { NO_SETUP_PLATFORMS_MESSAGE, type ResolvedSetupPlatforms, resolveSetupPlatforms } from "./lib/setupPlatforms";
import { logger } from "./logger";
import { fetchMarketplaceArchiveManifest, fetchMarketplaceDownload, fetchMarketplaceListing } from "./marketplace";

/**
 * The platforms to offer while setting up an instance, with the permissions
 * and local endpoints each one's current marketplace build declares. Choosing
 * a platform approves exactly those, and the later install refuses a build
 * that asks for more.
 *
 * Throws when the curated list is empty or the marketplace listing cannot be
 * read: setup cannot offer anything without them, and an empty list would look
 * like a finished one.
 */
export const listForSetup = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ResolvedSetupPlatforms> => {
    await requireInstanceRoleInAction(ctx, instanceId);

    const [curated, listing] = await Promise.all([
      ctx.runQuery(internal.setupPlatforms.listCurated, {}),
      fetchMarketplaceListing(),
    ]);
    if (curated.length === 0) {
      logger.error("setupPlatforms is empty; run setupPlatforms:seedDefaults");
      throw new Error(NO_SETUP_PLATFORMS_MESSAGE);
    }
    const listedIds = new Set(listing.map((entry) => entry.id));

    const manifests = await Promise.all(
      curated
        .filter((entry) => listedIds.has(entry.marketplaceModuleId))
        .map(async (entry): Promise<[string, unknown]> => {
          try {
            const download = await fetchMarketplaceDownload(entry.marketplaceModuleId);
            return [entry.marketplaceModuleId, await fetchMarketplaceArchiveManifest(download)];
          } catch (err) {
            logger.warn("could not read setup platform permissions", {
              marketplaceModuleId: entry.marketplaceModuleId,
              error: err instanceof Error ? err.message : String(err),
            });
            return [entry.marketplaceModuleId, null];
          }
        })
    );
    const permissionsById = new Map<string, string[] | null>(
      manifests.map(([id, manifest]) => [id, manifest === null ? null : parseManifestPermissions(manifest)])
    );
    const localEndpointsById = new Map<string, LocalEndpointSummary[]>(
      manifests.map(([id, manifest]) => [id, localEndpointSummaries(manifest)])
    );

    return resolveSetupPlatforms(curated, listing, permissionsById, localEndpointsById);
  },
});
