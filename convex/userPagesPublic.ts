import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import {
  isPublicSection,
  type PageContent,
  type PublicPageLookup,
  type PublicResourceState,
  pageBindings,
} from "@shared/user-pages";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type QueryCtx, query } from "./_generated/server";
import { normalizeSlug, slugAvailability } from "./lib/maintenanceClient";
import { type PublicPageSources, toPublicPage } from "./lib/publicPage";
import { instanceAllowsUserPages, instanceHoldingSlug, requireRevision, userPageForInstance } from "./lib/userPages";

// The visitor's side of a user page, open to anyone. It reads only Convex:
// nothing a visitor does reaches the engine. What it returns is the published
// page and the values its public sections bind, never an id that names an
// account, an instance or a resource.

/** Longer than any slug the maintenance API issues, so a longer one is answered without a read. */
const MAX_SLUG_LENGTH = 63;

/** Values for the resources `content`'s public sections bind, from the projection. */
async function publicStates(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  content: PageContent
): Promise<Map<string, PublicResourceState>> {
  const states = new Map<string, PublicResourceState>();
  for (const binding of pageBindings(content.sections.filter(isPublicSection))) {
    const row = await ctx.db
      .query("userPageState")
      .withIndex("by_instance_canonical", (q) => q.eq("instanceId", instanceId).eq("canonicalId", binding.canonicalId))
      .unique();
    if (row && row.kind === binding.kind) {
      states.set(binding.canonicalId, { kind: row.kind, value: row.value, settings: row.settings });
    }
  }
  return states;
}

async function publicLive(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  content: PageContent
): Promise<PublicPageSources["live"]> {
  const showsLive = content.sections
    .filter(isPublicSection)
    .some((section) => section.widgets.some((widget) => widget.type === "live-status"));
  if (!showsLive) {
    return null;
  }
  return ctx.db
    .query("instanceLiveState")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
}

/**
 * The page published at `/u/<slug>`. `unavailable` covers every reason an
 * engine's page is not shown (never published, taken offline, or no longer on
 * the plan) without saying which, and the page's content is kept for when it
 * returns.
 */
export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<PublicPageLookup> => {
    const slug = normalizeSlug(args.slug);
    if (slug === "" || slug.length > MAX_SLUG_LENGTH) {
      return { kind: "unclaimed" };
    }
    const instanceId = await instanceHoldingSlug(ctx, slug);
    if (!instanceId) {
      return { kind: "unclaimed" };
    }
    const instance = await ctx.db.get(instanceId);
    const page = await userPageForInstance(ctx, instanceId);
    if (!instance || !page?.publishedRevisionId || page.publishedAt === undefined) {
      return { kind: "unavailable" };
    }
    if (!(await instanceAllowsUserPages(ctx, instance))) {
      return { kind: "unavailable" };
    }
    const { content } = await requireRevision(ctx, page.publishedRevisionId);
    const [states, live] = await Promise.all([
      publicStates(ctx, instanceId, content),
      publicLive(ctx, instanceId, content),
    ]);
    return toPublicPage(slug, content, page.publishedAt, { states, live });
  },
});

// Anyone can ask, and each answer is a maintenance API call, so the bucket
// is global: there is no caller identity to key it on.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  userPageClaimable: { kind: "token bucket", rate: 600, period: MINUTE, capacity: 100 },
});

/**
 * Whether an `unclaimed` slug could still be made into an engine, so the
 * not-found page can invite a visitor to claim it. The maintenance API owns
 * the reserved names, so this asks it, as onboarding's slug check does.
 */
export const claimable = action({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<{ claimable: boolean }> => {
    const limit = await rateLimiter.limit(ctx, "userPageClaimable");
    if (!limit.ok) {
      throw new ConvexError("Too many requests. Try again in a minute.");
    }
    const { available } = await slugAvailability(slug);
    return { claimable: available };
  },
});
