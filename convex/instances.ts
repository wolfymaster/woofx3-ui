import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, type QueryCtx, query } from "./_generated/server";
import { deleteCompanion } from "./lib/companionRecords";
import { ensureSyncRow } from "./lib/engineSync/syncRow";
import type { InstanceRole } from "./lib/instanceRoles";
import { deleteInstanceAndEngine } from "./lib/instanceTeardown";
import { ensureInstanceMember, mapAccountRoleToInstanceRole } from "./lib/teamAccess";

/**
 * An instance row as members may see it. `webhookSecret` authenticates the
 * engine's callbacks to Convex and no browser has a use for it. `clientSecret`
 * stays: the browser's live WebSocket to the engine authenticates with it
 * (hooks/use-sync-engine-transport.ts).
 */
function withoutWebhookSecret(instance: Doc<"instances">): Omit<Doc<"instances">, "webhookSecret"> {
  const { webhookSecret: _webhookSecret, ...rest } = instance;
  return rest;
}

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const instances = await Promise.all(memberships.map((m) => ctx.db.get(m.instanceId)));
    return instances.filter((instance) => instance !== null).map(withoutWebhookSecret);
  },
});

export const get = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Verify user has access
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    if (!membership) return null;
    const instance = await ctx.db.get(args.instanceId);
    return instance ? withoutWebhookSecret(instance) : null;
  },
});

/**
 * Internal query for server-side lookups (e.g. registration action).
 * No auth check — only callable from other Convex functions.
 */
export const getInternal = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db.get(instanceId);
  },
});

export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    name: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user owns this account
    const account = await ctx.db.get(args.accountId);
    if (!account || account.ownerId !== userId) {
      throw new Error("Not authorized");
    }

    // An account has one engine, and a registration that failed leaves an
    // instance behind with no credentials. Retrying onboarding with a
    // corrected URL must land on that row rather than add a second one the
    // user would then have to choose between.
    const existing = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .take(50);
    const unregistered = existing.find((instance) => !instance.clientId && instance.hosting !== "managed");
    if (unregistered) {
      await ctx.db.patch(unregistered._id, { name: args.name, url: args.url, hosting: "external" });
      await ensureInstanceMember(ctx, unregistered._id, userId, "owner");
      return unregistered._id;
    }

    const instanceId = await ctx.db.insert("instances", {
      ...args,
      hosting: "external",
      createdAt: Date.now(),
    });

    // Add creator as owner member
    await ctx.db.insert("instanceMembers", {
      instanceId,
      userId,
      role: "owner",
    });

    const teammates = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();

    for (const m of teammates) {
      if (m.userId === userId) {
        continue;
      }
      await ensureInstanceMember(ctx, instanceId, m.userId, mapAccountRoleToInstanceRole(m.role));
    }

    return instanceId;
  },
});

export const update = mutation({
  args: {
    instanceId: v.id("instances"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    if (!membership || membership.role === "member") {
      throw new Error("Not authorized");
    }

    const { instanceId, ...updates } = args;
    await ctx.db.patch(instanceId, updates);
  },
});

export const deleteInstance = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId: args.instanceId, userId });
    if (!membership || membership.role === "member") {
      throw new Error("Not authorized");
    }

    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId: args.instanceId });
    if (!instance) throw new Error("Instance not found");

    await deleteInstanceAndEngine(ctx, instance);
  },
});

export const getMembership = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }) => {
    return ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
      .first();
  },
});

export const deleteInstanceData = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const platformLinks = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const link of platformLinks) {
      await ctx.db.delete(link._id);
    }

    const instanceMembers = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const member of instanceMembers) {
      await ctx.db.delete(member._id);
    }

    // Callbacks still arriving for the engine's teardown find no row, which
    // the maintenance webhook acknowledges.
    const provisioning = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (provisioning) {
      await ctx.db.delete(provisioning._id);
    }

    const companions = await ctx.db
      .query("companions")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const companion of companions) {
      await deleteCompanion(ctx, companion._id);
    }

    const pairings = await ctx.db
      .query("companionPairings")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const pairing of pairings) {
      await ctx.db.delete(pairing._id);
    }

    // Each pass reads past the rows it deleted, so the loop ends once none remain.
    for (;;) {
      const provenance = await ctx.db
        .query("moduleSettingProvenance")
        .withIndex("by_instance_module", (q) => q.eq("instanceId", instanceId))
        .take(200);
      if (provenance.length === 0) {
        break;
      }
      for (const row of provenance) {
        await ctx.db.delete(row._id);
      }
    }

    await ctx.db.delete(instanceId);
  },
});

// Public — deliberately omits accessToken/refreshToken. Only
// convex/platformRealtime.ts's internal-only getTwitchLink reads those, for
// server-side EventSub subscription calls that never send the token to the
// browser.
export const getPlatformLinks = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Same membership gate as `get` above: an instance id is not a secret, so
    // without this any signed-in user could enumerate another tenant's linked
    // channel, its platform user id, and which scopes it granted.
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();
    if (!membership) return [];

    const links = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .collect();

    // Relinking replaces the channel every member's automation runs against,
    // so only an owner or admin is offered it. Carried on each link rather
    // than as a separate query so the shell's reconnect banner stays on this
    // one subscription.
    const viewerCanRelink = membership.role === "owner" || membership.role === "admin";

    // Tokens never leave the backend — every caller that needs one goes
    // through platformRealtime.ensureFreshTwitchToken instead.
    return links.map(({ accessToken: _accessToken, refreshToken: _refreshToken, ...rest }) => ({
      ...rest,
      viewerCanRelink,
    }));
  },
});

/**
 * Internal mutation used by the registration action to persist handshake results.
 * Not exposed to clients.
 */
export const applyRegistration = internalMutation({
  args: {
    instanceId: v.id("instances"),
    clientId: v.string(),
    clientSecret: v.string(),
    webhookSecret: v.string(),
  },
  handler: async (ctx, { instanceId, clientId, clientSecret, webhookSecret }) => {
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }

    await ctx.db.patch(instanceId, { clientId, clientSecret, webhookSecret });
    await ensureSyncRow(ctx, instanceId);

    // Twitch can be connected while the engine is still being built, before
    // there is an engine to hand the token to. Send it now that there is.
    const links = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(20);
    if (links.some((link) => link.platform === "twitch")) {
      await ctx.scheduler.runAfter(0, internal.twitchIntegration.syncToEngine, { instanceId });
    }

    // Setup can finish before the engine exists; its choices are applied now.
    const setup = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (setup?.completedAt) {
      await ctx.scheduler.runAfter(0, internal.setupApply.run, { instanceId });
    }
  },
});

/**
 * Internal query to look up an instance by its webhook secret (callbackToken).
 * Used by the /api/webhooks/woofx3 endpoint for Bearer token auth.
 */
export const getByWebhookSecret = internalQuery({
  args: { webhookSecret: v.string() },
  handler: async (ctx, { webhookSecret }) => {
    return ctx.db
      .query("instances")
      .withIndex("by_webhook_secret", (q) => q.eq("webhookSecret", webhookSecret))
      .first();
  },
});

/** The user's role on the instance, or null when they are not a member. */
export async function readMemberRole(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">
): Promise<InstanceRole | null> {
  const membership = await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  return membership?.role ?? null;
}

/** `readMemberRole` for actions, which cannot read the db. */
export const memberRole = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }): Promise<InstanceRole | null> => {
    return await readMemberRole(ctx, instanceId, userId);
  },
});

/** The signed-in caller's role on the instance, or null when signed out or not a member. */
export const viewerRole = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<InstanceRole | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    return await readMemberRole(ctx, instanceId, userId);
  },
});
