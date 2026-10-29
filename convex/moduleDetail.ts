"use node";

import {
  applyMarketplaceMetadata,
  installedDetail,
  type MarketplaceMergeData,
  type ModuleDetailResult,
  manifestDeclarations,
  marketplaceDetail,
  marketplaceMetadataOf,
} from "@shared/module-detail";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import type { MarketplaceAccess } from "./lib/marketplaceAccess";
import { buyerRefFor } from "./lib/marketplaceEntitlement";
import { installedListing } from "./lib/marketplaceInstallIdentity";
import { logger } from "./logger";
import {
  fetchMarketplaceArchiveManifest,
  fetchMarketplaceDownload,
  marketplaceAccessForInstance,
  marketplaceFetch,
} from "./marketplace";

export const getModuleDetail = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId }): Promise<ModuleDetailResult<Id<"moduleRepository">>> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const access = await marketplaceAccessForInstance(ctx, instanceId);

    const installedModule = await ctx.runQuery(internal.moduleRepository.resolveModuleForDetail, {
      instanceId,
      moduleId,
    });

    if (installedModule) {
      // The DB is authoritative for installed modules, but we do not store the README. Fetch it
      // (and the icon / latest version / workflows) from the marketplace alongside the DB queries —
      // run concurrently rather than after, since the external marketplace call can take seconds
      // (up to MARKETPLACE_TIMEOUT_MS) and gains nothing from waiting on the DB queries first. Read
      // from the listing the module was installed from, so a later edition reports its own latest
      // version rather than its first edition's; a marketplace miss must not fail the detail.
      const marketplaceId = installedListing(installedModule)?.listingId;
      const [triggers, actions, functions, widgets, marketplaceMeta] = await Promise.all([
        ctx.runQuery(internal.triggerDefinitions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(internal.actionDefinitions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(internal.moduleFunctions.listByModule, { moduleId: installedModule._id }),
        ctx.runQuery(internal.moduleWidgets.listByModule, { moduleId: installedModule._id }),
        marketplaceId ? fetchMarketplaceMetadata(marketplaceId, access) : Promise.resolve(null),
      ]);

      const detail = installedDetail(
        {
          listingId: installedListing(installedModule)?.listingId ?? installedModule.name,
          moduleRef: installedModule._id,
          name: installedModule.name,
          description: installedModule.description,
          version: installedModule.version,
          author: installedModule.author,
          category: installedModule.category,
          tags: installedModule.tags,
          isInstalled: installedModule.status === "installed",
        },
        triggers,
        actions,
        functions,
        widgets,
        installedModule.manifest
      );
      if (marketplaceMeta) {
        applyMarketplaceMetadata(detail, marketplaceMeta);
      }
      if (marketplaceId && detail.latestVersion !== undefined && detail.latestVersion !== detail.version) {
        const latest = manifestDeclarations(await readMarketplaceManifest(ctx, instanceId, marketplaceId, access));
        detail.latestPermissions = latest.permissions;
        detail.latestLocalEndpoints = latest.localEndpoints;
      }
      return detail;
    }

    const [payload, manifest] = await Promise.all([
      marketplaceFetch(`/modules/${encodeURIComponent(moduleId)}`, access),
      readMarketplaceManifest(ctx, instanceId, moduleId, access),
    ]);
    return { ...marketplaceDetail(moduleId, payload, manifest), ...manifestDeclarations(manifest) };
  },
});

/**
 * Null when the archive cannot be read, which includes a paid module this
 * account has not bought: its archive is the product. The detail view still
 * renders: the permissions and local endpoints show as unknown, and functions
 * lose their file paths. Install does not depend on this read: it re-reads the
 * archive and refuses permissions the streamer did not approve.
 */
async function readMarketplaceManifest(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  marketplaceId: string,
  access: MarketplaceAccess
): Promise<unknown> {
  try {
    const content = { access, buyerRef: await buyerRefFor(ctx, instanceId) };
    return await fetchMarketplaceArchiveManifest(await fetchMarketplaceDownload(marketplaceId, content));
  } catch (err) {
    logger.warn("could not read marketplace module manifest", {
      marketplaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function fetchMarketplaceMetadata(
  marketplaceId: string,
  access: MarketplaceAccess
): Promise<MarketplaceMergeData | null> {
  try {
    return marketplaceMetadataOf(await marketplaceFetch(`/modules/${encodeURIComponent(marketplaceId)}`, access));
  } catch {
    // Module is not published to the marketplace (e.g. a manual upload), or the marketplace is
    // unreachable — the DB-sourced detail stands on its own.
    return null;
  }
}
