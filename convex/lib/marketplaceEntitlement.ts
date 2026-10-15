/**
 * Who may install a paid listing.
 *
 * Lives in `lib/` rather than beside the catalog actions because both halves
 * of the install path need it -- the module install in `marketplace.ts`
 * (`"use node"`, for archive hashing) and the bundle install in
 * `marketplaceCatalog.ts`. A file that defines Convex functions cannot be
 * imported across that boundary, so the shared guard belongs here.
 */

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { MarketplaceAccess } from "./marketplaceAccess";
import { marketplaceAuthed, marketplaceGet, queryString } from "./marketplaceApi";
import { parseCatalogDetail } from "./marketplaceCatalog";

/**
 * The buyer a purchase belongs to.
 *
 * Scoped to the account, not the instance or the user: a streamer who spins up
 * a second instance has still bought the thing, and a team member installing
 * it is acting for the account that paid. The marketplace treats the whole
 * string as opaque and never parses it, which is what keeps a user model out
 * of that service.
 */
export async function buyerRefFor(ctx: ActionCtx, instanceId: Id<"instances">): Promise<string> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance) {
    throw new ConvexError("Instance not found");
  }
  return `account:${instance.accountId}`;
}

/** The slice of the catalog this instance may see. */
export async function marketplaceAccessForInstanceId(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<MarketplaceAccess> {
  return await ctx.runQuery(internal.instances.getMarketplaceAccess, { instanceId });
}

/**
 * Refuses an install the account has not paid for.
 *
 * Whether a listing is paid is read from the *public* catalog, which needs no
 * credential, and only a paid listing goes on to the credential-gated
 * entitlement read. That ordering matters twice over:
 *
 * - A free install -- which is every install that existed before commerce --
 *   never touches the write token, so adding commerce did not add a
 *   configuration requirement to a flow that already worked.
 * - A paid listing with no `MARKETPLACE_API_TOKEN` configured fails loudly
 *   instead of installing ungated. Failing closed on a missing credential is
 *   the whole point of checking on the server rather than in the browser.
 *
 * The storefront also shows Buy instead of Install, but a client that simply
 * asked to install would otherwise install.
 */
export async function requireEntitlement(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  listingId: string,
  listingName: string
): Promise<void> {
  const payload = await marketplaceGet(
    `/catalog/${encodeURIComponent(listingId)}`,
    await marketplaceAccessForInstanceId(ctx, instanceId)
  );
  const wrapper = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const listing = parseCatalogDetail(wrapper.listing);
  if (!listing?.price) {
    return;
  }

  const buyerRef = await buyerRefFor(ctx, instanceId);
  const entitlement = await marketplaceAuthed(
    `/catalog/${encodeURIComponent(listingId)}/entitlement${queryString({ buyerRef })}`,
    "GET"
  );
  const obj = entitlement && typeof entitlement === "object" ? (entitlement as Record<string, unknown>) : {};
  if (obj.entitled !== true) {
    throw new ConvexError(`${listingName} has not been purchased on this account.`);
  }
}
