import { internalMutation } from "./_generated/server";

// One-shot cleanup for the orphan instanceSync rows that exist in the
// pre-spec deployment. Safe to delete after the first prod deploy.
export const dropAllInstanceSync = internalMutation({
  args: {},
  handler: async (ctx) => {
    // One-shot cleanup. Orphan count is small (3 in dev as of writing) — take
    // a generous ceiling that's still well under Convex read limits.
    const rows = await ctx.db.query("instanceSync").take(100);
    for (const r of rows) {
      await ctx.db.delete(r._id);
    }
    return rows.length;
  },
});
