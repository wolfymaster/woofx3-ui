"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { type LocalEndpointSummary, localEndpointSummaries } from "./lib/localEndpoints";
import {
  inspectThroughEngine,
  marketplaceEngineFor,
  marketplaceEngineSession,
  type SetupReview,
  setupReviewFromInspection,
} from "./lib/marketplaceEngineInstall";
import { buyerRefFor, buyerTokenFor } from "./lib/marketplaceEntitlement";
import { parseManifestPermissions } from "./lib/modulePermissions";
import { NO_SETUP_PLATFORMS_MESSAGE, type ResolvedSetupPlatforms, resolveSetupPlatforms } from "./lib/setupPlatforms";
import { logger } from "./logger";
import {
  fetchMarketplaceArchiveManifest,
  fetchMarketplaceDownload,
  fetchMarketplaceListing,
  marketplaceAccessForInstance,
} from "./marketplace";

/**
 * The platforms to offer while setting up an instance, with the permissions
 * and local endpoints each one's current marketplace build declares. Choosing
 * a platform approves exactly those, and the later install refuses a build
 * that asks for more.
 *
 * The builds are read on the engine when `marketplaceEngineFor` routes it
 * there, and otherwise from archives fetched here.
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
    const content = { access, buyerRef: await buyerRefFor(ctx, instanceId) };

    const [curated, listing] = await Promise.all([
      ctx.runQuery(internal.setupPlatforms.listCurated, {}),
      fetchMarketplaceListing(access),
    ]);
    if (curated.length === 0) {
      logger.error("setupPlatforms is empty; run setupPlatforms:seedDefaults");
      throw new Error(NO_SETUP_PLATFORMS_MESSAGE);
    }
    const listedIds = new Set(listing.map((entry) => entry.id));
    const viaEngine = await marketplaceEngineFor(ctx, instanceId);

    const reviews = await Promise.all(
      curated
        .filter((entry) => listedIds.has(entry.marketplaceModuleId))
        .map(async (entry): Promise<[string, SetupReview | null]> => {
          const id = entry.marketplaceModuleId;
          try {
            if (viaEngine) {
              const inspection = await inspectThroughEngine(
                { engine: () => marketplaceEngineSession(viaEngine), buyerToken: () => buyerTokenFor(ctx, instanceId) },
                id
              );
              return [id, setupReviewFromInspection(inspection)];
            }
            const manifest = await fetchMarketplaceArchiveManifest(await fetchMarketplaceDownload(id, content));
            return [
              id,
              { permissions: parseManifestPermissions(manifest), localEndpoints: localEndpointSummaries(manifest) },
            ];
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
      reviews.map(([id, review]) => [id, review === null ? null : review.permissions])
    );
    const localEndpointsById = new Map<string, LocalEndpointSummary[]>(
      reviews.map(([id, review]) => [id, review === null ? [] : review.localEndpoints])
    );

    return resolveSetupPlatforms(curated, listing, permissionsById, localEndpointsById);
  },
});
