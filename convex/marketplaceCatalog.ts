import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { MarketplaceError, marketplaceAuthed, marketplaceGet, queryString } from "./lib/marketplaceApi";
import {
  type AuthorPage,
  type CatalogCounts,
  type CatalogListingDetail,
  type CatalogPage,
  isBundleListing,
  LISTING_TYPES,
  parseAuthorPage,
  parseBundle,
  parseCatalogCounts,
  parseCatalogDetail,
  parseCatalogPage,
} from "./lib/marketplaceCatalog";
import {
  type InstallBundleResult,
  installBundleThroughEngine,
  marketplaceEngineFor,
  marketplaceEngineSession,
} from "./lib/marketplaceEngineInstall";
import {
  buyerRefFor,
  buyerTokenFor,
  grantQuery,
  marketplaceAccessForInstanceId,
  requireEntitlement,
} from "./lib/marketplaceEntitlement";
import { recordListingInstall } from "./lib/marketplaceInstalls";

// The marketplace storefront, across every listing type.
//
// The marketplace API owns the catalog; this file is the proxy in front of it.
// Its one addition is identity: the marketplace has no user model, so the
// buyer is an opaque `account:{id}` minted here, and the entitlement reads and
// checkout calls that depend on it carry the write token, which never leaves
// the server.

const listingTypeValidator = v.union(
  v.literal("module"),
  v.literal("theme"),
  v.literal("emote"),
  v.literal("overlay"),
  v.literal("alert")
);

// Two popularity orders, because they are two different questions: "popular"
// is the lifetime chart, "trending" is the last seven days. The storefront
// asks the marketplace for either rather than sorting a page it already paged,
// since the answer depends on rows it never fetched.
const sortValidator = v.union(
  v.literal("relevance"),
  v.literal("newest"),
  v.literal("name"),
  v.literal("popular"),
  v.literal("trending")
);

/** Searches and browses the whole marketplace: one query, every listing type. */
export const search = action({
  args: {
    instanceId: v.id("instances"),
    query: v.optional(v.string()),
    types: v.optional(v.array(listingTypeValidator)),
    category: v.optional(v.string()),
    authorSlug: v.optional(v.string()),
    /** Only curated listings, in `featuredRank` order. Drives the hero. */
    featured: v.optional(v.boolean()),
    sort: v.optional(sortValidator),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CatalogPage> => {
    await requireInstanceRoleInAction(ctx, args.instanceId);
    const path = `/catalog${queryString({
      q: args.query,
      type: args.types?.join(","),
      category: args.category,
      author: args.authorSlug,
      // Sent only when asked for: `featured=false` is not a filter, and the
      // marketplace reads the parameter's presence.
      featured: args.featured === true ? "true" : undefined,
      sort: args.sort,
      limit: args.limit,
      offset: args.offset,
    })}`;
    return parseCatalogPage(await marketplaceGet(path, await marketplaceAccessForInstanceId(ctx, args.instanceId)));
  },
});

/**
 * How many listings of each type the catalog holds, for the category tiles.
 *
 * Returns null rather than throwing when the marketplace has no counts route
 * yet: the tiles then count what the storefront already fetched instead of the
 * page failing over a number beside a label.
 */
export const counts = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<CatalogCounts | null> => {
    await requireInstanceRoleInAction(ctx, args.instanceId);
    try {
      return parseCatalogCounts(
        await marketplaceGet("/catalog/counts", await marketplaceAccessForInstanceId(ctx, args.instanceId))
      );
    } catch (err) {
      if (err instanceof MarketplaceError && (err.status === 404 || err.status === 400)) {
        return null;
      }
      throw err;
    }
  },
});

/** One listing with everything its page shows. */
export const getListing = action({
  args: { instanceId: v.id("instances"), listingId: v.string() },
  handler: async (ctx, args): Promise<CatalogListingDetail | null> => {
    await requireInstanceRoleInAction(ctx, args.instanceId);
    try {
      const payload = await marketplaceGet(
        `/catalog/${encodeURIComponent(args.listingId)}`,
        await marketplaceAccessForInstanceId(ctx, args.instanceId)
      );
      const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      return parseCatalogDetail(obj.listing);
    } catch (err) {
      // A listing that is missing, dev-tier or unpublished answers 404
      // identically, so the page shows "not found" rather than an error.
      if (err instanceof MarketplaceError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },
});

/** An author's page: the profile, and every listing of every type they made. */
export const getAuthor = action({
  args: { instanceId: v.id("instances"), slug: v.string() },
  handler: async (ctx, args): Promise<AuthorPage | null> => {
    await requireInstanceRoleInAction(ctx, args.instanceId);
    try {
      return parseAuthorPage(
        await marketplaceGet(
          `/authors/${encodeURIComponent(args.slug)}`,
          await marketplaceAccessForInstanceId(ctx, args.instanceId)
        )
      );
    } catch (err) {
      if (err instanceof MarketplaceError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },
});

/**
 * Every paid listing this account holds.
 *
 * Fetched once for a whole grid rather than per card: the storefront needs to
 * know which buttons say Install and which say Buy, and that is one answer.
 */
export const entitlements = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<string[]> => {
    await requireInstanceRoleInAction(ctx, args.instanceId);
    const buyerRef = await buyerRefFor(ctx, args.instanceId);
    const payload = await marketplaceAuthed(`/entitlements${queryString({ buyerRef })}`, "GET");
    const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const ids = Array.isArray(obj.listingIds) ? obj.listingIds : [];
    return ids.filter((id): id is string => typeof id === "string");
  },
});

export type CheckoutResult =
  | { status: "redirect"; url: string }
  /** Already bought. The button becomes Install without a round trip to Stripe. */
  | { status: "already_entitled" }
  /** Commerce is not configured on this deployment. */
  | { status: "unavailable"; message: string };

/**
 * `returnPath` is a path within this app, never a URL.
 *
 * Joining it onto a configured origin here is what makes an open redirect
 * impossible: a caller cannot name another host, so a Stripe payment page can
 * only ever send the buyer back into woofx3. The marketplace's own
 * `CHECKOUT_RETURN_ORIGINS` is the second layer.
 */
function returnUrl(returnPath: string): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (!base) {
    throw new ConvexError("Checkout is not configured: set APP_BASE_URL");
  }
  if (!returnPath.startsWith("/") || returnPath.startsWith("//")) {
    throw new ConvexError("Invalid return path");
  }
  return `${base}${returnPath}`;
}

/** Starts a Stripe checkout for a paid listing. */
export const createCheckout = action({
  args: {
    instanceId: v.id("instances"),
    listingId: v.string(),
    /** Path in this app to come back to, e.g. `/marketplace/cozy-cats`. */
    returnPath: v.string(),
  },
  handler: async (ctx, args): Promise<CheckoutResult> => {
    // A purchase spends the account's money, so it takes more than membership.
    await requireInstanceRoleInAction(ctx, args.instanceId, "admin");
    const buyerRef = await buyerRefFor(ctx, args.instanceId);
    const base = returnUrl(args.returnPath);
    const separator = base.includes("?") ? "&" : "?";

    try {
      const payload = await marketplaceAuthed("/checkout/sessions", "POST", {
        listingId: args.listingId,
        buyerRef,
        successUrl: `${base}${separator}purchase=success`,
        cancelUrl: `${base}${separator}purchase=cancelled`,
      });
      const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      if (obj.alreadyEntitled === true) {
        return { status: "already_entitled" };
      }
      if (typeof obj.url !== "string" || obj.url === "") {
        throw new ConvexError("The marketplace did not return a checkout URL");
      }
      return { status: "redirect", url: obj.url };
    } catch (err) {
      if (err instanceof MarketplaceError && err.status === 503) {
        return {
          status: "unavailable",
          message: "Purchases aren't available yet on this deployment.",
        };
      }
      throw err;
    }
  },
});

export type { InstallBundleResult };

/**
 * Installs an overlay or alert listing.
 *
 * These are not modules: the listing carries the scene or alert-composition
 * document itself, so installing one is writing that document through the
 * engine calls the scene editor and the alert library already use. Nothing is
 * loaded into the module runtime, which is the whole reason they are not
 * modules.
 *
 * Runs on the engine when `marketplaceEngineFor` routes it there; the engine
 * then reads the listing, claims it for the buyer and writes the document.
 */
export const installBundle = action({
  args: { instanceId: v.id("instances"), listingId: v.string() },
  handler: async (ctx, args): Promise<InstallBundleResult> => {
    await requireInstanceRoleInAction(ctx, args.instanceId);

    const viaEngine = await marketplaceEngineFor(ctx, args.instanceId);
    if (viaEngine) {
      // `acquire` records the install on the marketplace, so no install ping is sent from here.
      return await installBundleThroughEngine(
        { engine: () => marketplaceEngineSession(viaEngine), buyerToken: () => buyerTokenFor(ctx, args.instanceId) },
        args.listingId
      );
    }

    const payload = await marketplaceGet(
      `/catalog/${encodeURIComponent(args.listingId)}`,
      await marketplaceAccessForInstanceId(ctx, args.instanceId)
    );
    const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const listing = parseCatalogDetail(obj.listing);
    if (!listing) {
      throw new ConvexError(`Marketplace listing ${args.listingId} was not found`);
    }
    if (!isBundleListing(listing.type)) {
      throw new ConvexError(`${listing.name} is a ${listing.type} listing and does not install as a bundle`);
    }
    // The same gate the module install uses. The marketplace serves a paid
    // bundle only for the buyer it was sold to, so this is not the only check.
    const grant = await requireEntitlement(ctx, args.instanceId, listing.id, listing.name);
    const bundlePath = `/catalog/${encodeURIComponent(listing.id)}/bundle`;
    const bundlePayload =
      grant.kind === "paid"
        ? await marketplaceAuthed(`${bundlePath}${grantQuery(grant)}`, "GET")
        : await marketplaceGet(bundlePath, await marketplaceAccessForInstanceId(ctx, args.instanceId));
    const bundle = parseBundle(bundlePayload);
    if (!bundle) {
      throw new ConvexError(`${listing.name} carries no bundle to install`);
    }
    const layoutJson = JSON.stringify(bundle.layout ?? {});
    const widgetsJson = JSON.stringify(bundle.widgets ?? []);

    if (listing.type === "overlay") {
      const { engineSceneId } = await ctx.runAction(internal.marketplaceCatalog.createSceneFromBundle, {
        instanceId: args.instanceId,
        name: listing.name,
        description: listing.description,
        layoutJson,
        widgetsJson,
      });
      await recordListingInstall(listing.id);
      return { listingId: listing.id, engineId: engineSceneId, kind: "scene" };
    }

    const { engineCompositionId } = await ctx.runAction(internal.marketplaceCatalog.createAlertFromBundle, {
      instanceId: args.instanceId,
      name: listing.name,
      description: listing.description,
      layoutJson,
      widgetsJson,
      behaviorsJson: JSON.stringify(bundle.behaviors ?? {}),
      inputsJson: JSON.stringify(bundle.inputs ?? []),
    });
    await recordListingInstall(listing.id);
    return { listingId: listing.id, engineId: engineCompositionId, kind: "alert" };
  },
});

// --- engine writes ---
//
// Split into internal actions rather than called inline so the bundle install
// reads as one sequence. Each gets its own capnweb session, because an HTTP
// batch is spent by its first call.

export const createSceneFromBundle = internalAction({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    description: v.optional(v.string()),
    layoutJson: v.string(),
    widgetsJson: v.string(),
  },
  handler: async (ctx, args): Promise<{ engineSceneId: string }> => {
    const engine = await engineFor(ctx, args.instanceId);
    const result = await createEngineRpcSession<EngineApi>(
      engine.url,
      engine.clientId,
      engine.clientSecret
    ).createScene({
      name: args.name,
      description: args.description,
      widgetsJson: args.widgetsJson,
      layoutJson: args.layoutJson,
      correlationKey: crypto.randomUUID(),
    });
    return { engineSceneId: result.id };
  },
});

export const createAlertFromBundle = internalAction({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    description: v.optional(v.string()),
    layoutJson: v.string(),
    widgetsJson: v.string(),
    behaviorsJson: v.string(),
    inputsJson: v.string(),
  },
  handler: async (ctx, args): Promise<{ engineCompositionId: string }> => {
    const engine = await engineFor(ctx, args.instanceId);
    const result = await createEngineRpcSession<EngineApi>(
      engine.url,
      engine.clientId,
      engine.clientSecret
    ).createAlertComposition({
      name: args.name,
      description: args.description,
      widgetsJson: args.widgetsJson,
      layoutJson: args.layoutJson,
      behaviorsJson: args.behaviorsJson,
      inputsJson: args.inputsJson,
      correlationKey: crypto.randomUUID(),
    });
    return { engineCompositionId: result.id };
  },
});

async function engineFor(ctx: ActionCtx, instanceId: Id<"instances">) {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance) {
    throw new ConvexError(`Instance ${instanceId} not found`);
  }
  if (!instance.clientId || !instance.clientSecret) {
    throw new ConvexError("Instance is not registered with the engine");
  }
  return { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
}

/** Every listing type, for a client that renders one tab or filter per type. */
export const listingTypes = LISTING_TYPES;
