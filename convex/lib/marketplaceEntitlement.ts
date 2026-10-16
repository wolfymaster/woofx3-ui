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
import { MarketplaceError, marketplaceAuthed, marketplaceGet, queryString } from "./marketplaceApi";

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
 * How a listing's content -- a module archive or a bundle -- may be fetched
 * for an account. The marketplace serves a free listing's content to anyone,
 * and a paid listing's only with the write token and the buyer it was sold to.
 */
export type ContentGrant = { kind: "free" } | { kind: "paid"; buyerRef: string };

/**
 * Refuses a listing the account has not paid for, and otherwise says how to
 * fetch its content.
 *
 * Fails closed. With `MARKETPLACE_API_TOKEN` set, the marketplace's
 * entitlement read is the only answer trusted: it knows whether a listing is
 * paid, so nothing here has to parse a price, and any answer it does not
 * recognise is a refusal. Without the token, a listing is treated as free
 * only when the public catalog carries no price for it at all; a price in any
 * shape, or a listing that cannot be read, refuses the install rather than
 * guessing. Free installs, which are every install that existed before
 * commerce, therefore still need no new configuration.
 *
 * The storefront also shows Buy instead of Install, but that is not a guard:
 * this is, and the marketplace refuses paid content to anyone else.
 */
export async function requireEntitlement(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  listingId: string,
  listingName: string
): Promise<ContentGrant> {
  const path = `/catalog/${encodeURIComponent(listingId)}`;
  if (!process.env.MARKETPLACE_API_TOKEN?.trim()) {
    const payload = await marketplaceGet(path, await marketplaceAccessForInstanceId(ctx, instanceId));
    if (catalogListingIsFree(payload)) {
      return { kind: "free" };
    }
    throw new ConvexError(
      `${listingName} is a paid listing, and purchases cannot be checked on this deployment (MARKETPLACE_API_TOKEN is not set).`
    );
  }

  const buyerRef = await buyerRefFor(ctx, instanceId);
  let answer: unknown;
  try {
    answer = await marketplaceAuthed(`${path}/entitlement${queryString({ buyerRef })}`, "GET");
  } catch (err) {
    if (err instanceof MarketplaceError && err.status === 404) {
      throw new ConvexError(`${listingName} is no longer in the marketplace.`);
    }
    throw err;
  }
  const grant = grantFromEntitlement(answer, buyerRef);
  if (!grant) {
    throw new ConvexError(`${listingName} has not been purchased on this account.`);
  }
  return grant;
}

/**
 * The grant an entitlement answer carries, or null when it does not entitle.
 * Anything but the two entitled shapes is null, so a changed answer refuses
 * rather than installs.
 */
export function grantFromEntitlement(answer: unknown, buyerRef: string): ContentGrant | null {
  const obj = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  if (obj.entitled !== true) {
    return null;
  }
  if (obj.free === true) {
    return { kind: "free" };
  }
  if (obj.free === false) {
    return { kind: "paid", buyerRef };
  }
  return null;
}

/**
 * Whether a public catalog detail shows a listing as free: readable, and with
 * no price at all. A price that is present but unreadable counts as paid.
 */
export function catalogListingIsFree(payload: unknown): boolean {
  const wrapper = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const listing = wrapper?.listing;
  if (!listing || typeof listing !== "object") {
    return false;
  }
  const price = (listing as Record<string, unknown>).price;
  return price === undefined || price === null;
}

/** Query parameters that fetch a listing's content under `grant`. */
export function grantQuery(grant: ContentGrant): string {
  return grant.kind === "paid" ? queryString({ buyerRef: grant.buyerRef }) : "";
}
