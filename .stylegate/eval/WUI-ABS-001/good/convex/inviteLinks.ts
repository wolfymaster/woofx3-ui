import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const byToken = query({
  args: { token: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!inv || inv.status !== "pending" || inv.expiresAt <= args.now) {
      return null;
    }
    return { accountId: inv.accountId, startedOn: new Date(inv.createdAt).toISOString().slice(0, 10) };
  },
});

export const accept = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.invitationId, { status: "accepted", acceptedAt: Date.now() });
  },
});
