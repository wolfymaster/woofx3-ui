import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * One-time: insert accountMembers(owner) for each account whose owner has no row.
 *
 *   bunx convex run migrations/backfillAccountMembers:default
 */
export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    const accounts = await ctx.db.query("accounts").collect();
    let inserted = 0;

    for (const account of accounts) {
      const existing = await ctx.db
        .query("accountMembers")
        .withIndex("by_account_user", (q) =>
          q.eq("accountId", account._id).eq("userId", account.ownerId),
        )
        .first();

      if (!existing) {
        await ctx.db.insert("accountMembers", {
          accountId: account._id,
          userId: account.ownerId,
          role: "owner",
          createdAt: account.createdAt,
        });
        inserted++;
      }
    }

    return { accountsScanned: accounts.length, inserted };
  },
});
