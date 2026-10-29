import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { type PageSection, type PublicPageLookup, type PublicResourceState, pageBindings } from "@shared/user-pages";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type QueryCtx, query } from "./_generated/server";
import { slugAvailability } from "./lib/maintenanceClient";
import { openSections, type PublicPageSources, toPublicPage } from "./lib/publicPage";
import type { PageViewer } from "./lib/sectionAccess";
import { instanceAllowsUserPages, instanceForPageSlug, requireRevision, userPageForInstance } from "./lib/userPages";
import { broadcasterForInstance, viewerFromSession, viewerRolesFor } from "./lib/viewerSessionAuth";

// The visitor's side of a user page, open to anyone. It reads only Convex:
// nothing a visitor does reaches the engine. What it returns is the published
// page, the sections the viewer may see and the values only those bind, never
// an id that names an account, an instance or a resource.

/**
 * The viewer `sessionToken` signs in, as section visibility sees them on the
 * page of `instanceId`. Fails closed: a token that signs nobody in is an
 * anonymous visitor.
 */
async function pageViewer(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  sessionToken: string | null
): Promise<PageViewer> {
  const viewer = await viewerFromSession(ctx, sessionToken);
  if (!viewer) {
    return { kind: "anonymous" };
  }
  const broadcaster = await broadcasterForInstance(ctx, instanceId);
  if (!broadcaster || broadcaster.platform !== viewer.platform) {
    return { kind: "signed_in", roles: { kind: "uncheckable" } };
  }
  const roles = await viewerRolesFor(ctx, viewer._id, broadcaster.platformUserId);
  if (!roles) {
    return { kind: "signed_in", roles: { kind: "unknown" } };
  }
  return {
    kind: "signed_in",
    roles: { kind: "known", follower: roles.follower, subscriberTier: roles.subscriberTier },
  };
}

/** Values for the resources `sections` bind, from the projection. */
async function sectionStates(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  sections: readonly PageSection[]
): Promise<Map<string, PublicResourceState>> {
  const states = new Map<string, PublicResourceState>();
  for (const binding of pageBindings(sections)) {
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

async function sectionLive(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  sections: readonly PageSection[]
): Promise<PublicPageSources["live"]> {
  const showsLive = sections.some((section) => section.widgets.some((widget) => widget.type === "live-status"));
  if (!showsLive) {
    return null;
  }
  return ctx.db
    .query("instanceLiveState")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
}

/**
 * The page published at `/u/<slug>`, as the viewer `sessionToken` signs in
 * may see it (an anonymous visitor without one). `unavailable` covers every
 * reason an engine's page is not shown (never published, taken offline, or no
 * longer on the plan) without saying which, and the page's content is kept
 * for when it returns.
 *
 * A query cannot ask the platform, so a section gated on roles the viewer has
 * no current check for comes back locked with `rolesStale` set; the page then
 * calls `viewerRoles.refresh`, whose write re-runs this query.
 */
export const bySlug = query({
  args: { slug: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, args): Promise<PublicPageLookup> => {
    const held = await instanceForPageSlug(ctx, args.slug);
    if (!held) {
      return { kind: "unclaimed" };
    }
    const { slug, instanceId } = held;
    const instance = await ctx.db.get(instanceId);
    const page = await userPageForInstance(ctx, instanceId);
    if (!instance || !page?.publishedRevisionId || page.publishedAt === undefined) {
      return { kind: "unavailable" };
    }
    if (!(await instanceAllowsUserPages(ctx, instance))) {
      return { kind: "unavailable" };
    }
    const { content } = await requireRevision(ctx, page.publishedRevisionId);
    const viewer = await pageViewer(ctx, instanceId, args.sessionToken ?? null);
    const shown = openSections(content, viewer);
    const [states, live] = await Promise.all([
      sectionStates(ctx, instanceId, shown),
      sectionLive(ctx, instanceId, shown),
    ]);
    return toPublicPage(slug, content, page.publishedAt, viewer, { states, live });
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
