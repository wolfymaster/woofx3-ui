/**
 * Who may install a listing, and how its content is fetched.
 *
 * Lives in `lib/` rather than beside the catalog actions because both halves
 * of the install path need it -- the module install in `marketplace.ts`
 * (`"use node"`, for archive hashing) and the bundle install in
 * `marketplaceCatalog.ts`. A file that defines Convex functions cannot be
 * imported across that boundary, so the shared code belongs here.
 *
 * The marketplace answers the one question that matters -- does this account
 * hold this listing id? -- and decides what it costs. Nothing here parses a
 * price to decide whether an install may go ahead.
 */

import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { type MarketplaceAccess, marketplaceAccessFor } from "./marketplaceAccess";
import { MarketplaceError, marketplaceAuthed, marketplaceGet, queryString } from "./marketplaceApi";
import { buyerSigningKeyFromEnv, mintBuyerToken } from "./marketplaceBuyerToken";

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
  return buyerRefForAccount((await instanceForBuyer(ctx, instanceId)).accountId);
}

function buyerRefForAccount(accountId: Id<"accounts">): string {
  return `account:${accountId}`;
}

async function instanceForBuyer(ctx: ActionCtx, instanceId: Id<"instances">) {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance) {
    throw new ConvexError("Instance not found");
  }
  return instance;
}

/**
 * A five-minute marketplace buyer token for the account that owns
 * `instanceId`, for an engine to present in place of the write token.
 *
 * Its `sub` is exactly `buyerRefFor`'s value, and it carries `tier: "dev"`
 * exactly when the instance has dev marketplace access, so the token grants
 * no more than this deployment already asks for on the account's behalf. Like
 * `buyerRefFor`, it does not authorize the caller: the action calling it must
 * already have checked membership (`requireInstanceRoleInAction`).
 *
 * Throws when `MARKETPLACE_BUYER_SIGNING_KEY` or `_KEY_ID` is not set.
 */
export async function buyerTokenFor(ctx: ActionCtx, instanceId: Id<"instances">): Promise<string> {
  const instance = await instanceForBuyer(ctx, instanceId);
  const key = await buyerSigningKeyFromEnv();
  return await mintBuyerToken(buyerRefForAccount(instance.accountId), marketplaceAccessFor(instance), key);
}

/** The slice of the catalog this instance may see. */
export async function marketplaceAccessForInstanceId(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<MarketplaceAccess> {
  return await ctx.runQuery(internal.instances.getMarketplaceAccess, { instanceId });
}

/** Whether this deployment holds the marketplace's write token. */
export function commerceConfigured(): boolean {
  return Boolean(process.env.MARKETPLACE_API_TOKEN?.trim());
}

/**
 * What a content fetch for an instance needs: the catalog slice it may see,
 * and the buyer to fetch as when the content is not free.
 */
export interface ContentAccess {
  access: MarketplaceAccess;
  buyerRef: string;
}

export async function contentAccessFor(ctx: ActionCtx, instanceId: Id<"instances">): Promise<ContentAccess> {
  const [access, buyerRef] = await Promise.all([
    marketplaceAccessForInstanceId(ctx, instanceId),
    buyerRefFor(ctx, instanceId),
  ]);
  return { access, buyerRef };
}

/**
 * Fetches what a listing installs -- a module archive's download URL or a
 * bundle -- for an account.
 *
 * Asked anonymously first, at the instance's own access, because that is how
 * a free listing's content is served and it keeps the instance's catalog
 * slice in force: a listing hidden from it answers 404 and nothing more. A
 * 401 means the listing is visible but not free, and only then is it asked
 * again with the write token as the buyer. The marketplace serves it only if
 * that account holds the listing, so this never decides who may have it.
 */
export async function fetchListingContent(path: string, content: ContentAccess): Promise<unknown> {
  try {
    return await marketplaceGet(path, content.access);
  } catch (err) {
    if (!(err instanceof MarketplaceError) || err.status !== 401 || !commerceConfigured()) {
      throw err;
    }
  }
  return await marketplaceAuthed(`${path}${queryString({ buyerRef: content.buyerRef })}`, "GET");
}

/**
 * Makes sure the account holds a listing before it is installed.
 *
 * With the write token, the marketplace's acquire is the only answer: it
 * records the claim of a free listing or a free upgrade (which is also what
 * counts the install), confirms one already held, and refuses one that costs
 * money or that nobody can acquire. Without the token nothing can be
 * recorded, so only a listing the public catalog prices free installs; the
 * marketplace then serves its content to anyone anyway.
 *
 * The storefront also shows Buy instead of Install, but that is not a guard:
 * this is, and the marketplace refuses paid content to anyone else.
 */
export async function acquireListing(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  listingId: string,
  listingName: string
): Promise<void> {
  const path = `/catalog/${encodeURIComponent(listingId)}`;
  if (!commerceConfigured()) {
    const payload = await marketplaceGet(path, await marketplaceAccessForInstanceId(ctx, instanceId));
    if (publicListingIsFree(payload)) {
      return;
    }
    throw new ConvexError(
      `${listingName} is not free, and purchases cannot be checked on this deployment (MARKETPLACE_API_TOKEN is not set).`
    );
  }

  const buyerRef = await buyerRefFor(ctx, instanceId);
  try {
    await marketplaceAuthed(`${path}/acquire`, "POST", { buyerRef });
  } catch (err) {
    const message = acquireRefusal(err, listingName);
    if (message !== null) {
      throw new ConvexError(message);
    }
    throw err;
  }
}

/** What the streamer is told about a listing their account does not hold. */
export function notBoughtMessage(listingName: string): string {
  return `${listingName} hasn't been bought on this account.`;
}

/**
 * What to tell the streamer when acquire refuses, or null for a failure that
 * is not a refusal (and is rethrown as it is).
 */
export function acquireRefusal(err: unknown, listingName: string): string | null {
  if (!(err instanceof MarketplaceError)) {
    return null;
  }
  switch (err.status) {
    case 402:
      return notBoughtMessage(listingName);
    case 404:
      return `${listingName} is no longer in the marketplace.`;
    case 409:
      // The marketplace says why: unpriced, unpublished, or replaced by a
      // newer edition. Its message is written for a person.
      return err.code === "listing_unavailable" ? err.message : null;
    default:
      return null;
  }
}

/**
 * What to tell the streamer when a listing's content is refused, or null for
 * a failure that is not a refusal. A 401 reaches here only when this
 * deployment has no write token to ask as the buyer.
 */
export function contentRefusal(err: unknown, listingName: string): string | null {
  if (!(err instanceof MarketplaceError)) {
    return null;
  }
  if (err.status === 403 && err.code === "not_entitled") {
    return notBoughtMessage(listingName);
  }
  if (err.status === 401) {
    return `${listingName} is not free, and purchases cannot be checked on this deployment (MARKETPLACE_API_TOKEN is not set).`;
  }
  return null;
}

/**
 * Whether a public catalog detail prices a listing free. Only an explicit
 * `pricing.mode` of "free" counts: no pricing means nobody can install it, and
 * a shape this does not recognise refuses rather than installs.
 */
export function publicListingIsFree(payload: unknown): boolean {
  const wrapper = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const listing = wrapper?.listing;
  if (!listing || typeof listing !== "object") {
    return false;
  }
  const pricing = (listing as Record<string, unknown>).pricing;
  return Boolean(pricing && typeof pricing === "object" && (pricing as Record<string, unknown>).mode === "free");
}
