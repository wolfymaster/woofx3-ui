import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";

export const byToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!inv || inv.status !== "pending" || inv.expiresAt <= Date.now()) {
      return null;
    }
    return { accountId: inv.accountId, email: inv.email };
  },
});

export const flagsForToday = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await ctx.db.query("featureFlags").take(500);
    return rows.filter((row) => !row.expiresOn || row.expiresOn >= today);
  },
});
