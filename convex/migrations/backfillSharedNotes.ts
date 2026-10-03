import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * One-time: fold each instance's per-user `dashboardNotes` into its single
 * shared `instanceNotes` row.
 *
 *   bunx convex run migrations/backfillSharedNotes:default
 *
 * Notes used to be private to each member. An instance where one member kept
 * notes gets theirs as is. Where several did, the notes are joined, each under
 * its author's name, so nothing is dropped and nobody's notes silently win.
 *
 * Idempotent: an instance that already has a shared note is left alone.
 */
export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    const legacy = await ctx.db.query("dashboardNotes").collect();

    const byInstance = new Map<Id<"instances">, Doc<"dashboardNotes">[]>();
    for (const row of legacy) {
      if (row.content.trim() === "") {
        continue;
      }
      const rows = byInstance.get(row.instanceId) ?? [];
      rows.push(row);
      byInstance.set(row.instanceId, rows);
    }

    let seeded = 0;
    let alreadyShared = 0;
    for (const [instanceId, rows] of byInstance) {
      const existing = await ctx.db
        .query("instanceNotes")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .unique();
      if (existing) {
        alreadyShared++;
        continue;
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      let content = rows[0].content;
      if (rows.length > 1) {
        const sections: string[] = [];
        for (const row of rows) {
          const author = await ctx.db.get(row.userId);
          sections.push(`--- ${author?.name ?? "A former member"} ---\n${row.content}`);
        }
        content = sections.join("\n\n");
      }
      await ctx.db.insert("instanceNotes", {
        instanceId,
        content,
        updatedAt: rows[0].updatedAt,
        updatedBy: rows[0].userId,
      });
      seeded++;
    }

    return { legacyRows: legacy.length, instancesSeeded: seeded, alreadyShared };
  },
});
