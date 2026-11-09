import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { approvalStands, companionByToken, rowByToken } from "./lib/companionAuth";
import {
  isCompanionToken,
  isValidCompanionVersion,
  MAX_COMPANION_ROWS_PER_INSTANCE,
  MAX_COMPANION_VERSION_LENGTH,
} from "./lib/companionCodes";
import { approverDisplayName, deleteCompanion } from "./lib/companionRecords";
import { requireInstanceRole } from "./lib/instanceAccess";
import { isInstanceMember } from "./lib/teamAccess";

/**
 * Functions a paired companion calls with its token, and the instance admin's
 * view of its companions. Token functions authenticate through
 * lib/companionAuth.ts and fail closed.
 */

/**
 * The companion subscribes to this with the token it generated. Null means
 * unpaired, and the companion forgets its token. `approvedByName` and
 * `confirmed` are kept for desktop apps that still read them.
 */
export const self = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      companionId: v.id("companions"),
      instanceId: v.id("instances"),
      instanceName: v.string(),
      approvedByName: v.string(),
      confirmed: v.boolean(),
    })
  ),
  handler: async (ctx, { token }) => {
    const companion = await companionByToken(ctx, token);
    if (!companion) {
      return null;
    }
    const instance = await ctx.db.get(companion.instanceId);
    if (!instance) {
      return null;
    }
    const approver = await ctx.db.get(companion.pairedBy);
    return {
      companionId: companion._id,
      instanceId: instance._id,
      instanceName: instance.name,
      approvedByName: approverDisplayName(approver),
      confirmed: companion.confirmedAt !== undefined,
    };
  },
});

export const heartbeat = mutation({
  args: { token: v.string(), companionVersion: v.string() },
  returns: v.object({ paired: v.boolean() }),
  handler: async (ctx, args) => {
    const companionVersion = args.companionVersion.trim();
    if (!isValidCompanionVersion(companionVersion)) {
      throw new ConvexError(`companionVersion must be 1-${MAX_COMPANION_VERSION_LENGTH} characters`);
    }
    const companion = await companionByToken(ctx, args.token);
    if (!companion) {
      return { paired: false };
    }
    const now = Date.now();
    const presence = await ctx.db
      .query("companionPresence")
      .withIndex("by_companion", (q) => q.eq("companionId", companion._id))
      .first();
    if (presence) {
      await ctx.db.patch(presence._id, { lastSeenAt: now, companionVersion });
    } else {
      await ctx.db.insert("companionPresence", { companionId: companion._id, lastSeenAt: now, companionVersion });
    }
    return { paired: true };
  },
});

/**
 * Unpair from the companion itself. Holding the token is enough, even when
 * the approval no longer stands, so a companion can always remove itself.
 */
export const unpair = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, { token }) => {
    if (!isCompanionToken(token)) {
      return null;
    }
    const companion = await rowByToken(ctx, token);
    if (companion) {
      await deleteCompanion(ctx, companion._id);
    }
    return null;
  },
});

/**
 * The instance's companion, for its members, or null when it has none. An
 * instance has at most one (approving a new one replaces it); should older
 * rows remain, the most recently paired is the one shown. `lastSeenAt` is
 * null until the first heartbeat; whether that is "online" is judged in the
 * browser, since this query does not re-run as time passes.
 */
export const forInstance = query({
  args: { instanceId: v.id("instances") },
  returns: v.union(
    v.null(),
    v.object({
      companionId: v.id("companions"),
      deviceName: v.string(),
      companionVersion: v.string(),
      pairedAt: v.number(),
      lastSeenAt: v.union(v.number(), v.null()),
      confirmed: v.boolean(),
      approvalStands: v.boolean(),
    })
  ),
  handler: async (ctx, { instanceId }) => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    const rows = await ctx.db
      .query("companions")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(MAX_COMPANION_ROWS_PER_INSTANCE);
    let companion: Doc<"companions"> | null = null;
    for (const row of rows) {
      if (!companion || row.pairedAt > companion.pairedAt) {
        companion = row;
      }
    }
    if (!companion) {
      return null;
    }
    const companionId = companion._id;
    const presence = await ctx.db
      .query("companionPresence")
      .withIndex("by_companion", (q) => q.eq("companionId", companionId))
      .first();
    return {
      companionId,
      deviceName: companion.deviceName,
      companionVersion: presence?.companionVersion ?? companion.companionVersion,
      pairedAt: companion.pairedAt,
      lastSeenAt: presence?.lastSeenAt ?? null,
      confirmed: companion.confirmedAt !== undefined,
      approvalStands: await approvalStands(ctx, companion),
    };
  },
});

export const revoke = mutation({
  args: { companionId: v.id("companions") },
  returns: v.null(),
  handler: async (ctx, { companionId }) => {
    const companion = await ctx.db.get(companionId);
    if (!companion) {
      return null;
    }
    await requireInstanceRole(ctx, companion.instanceId, "admin");
    await deleteCompanion(ctx, companionId);
    return null;
  },
});
