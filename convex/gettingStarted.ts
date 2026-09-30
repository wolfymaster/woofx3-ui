import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { isManualGettingStartedItemId } from "./lib/gettingStarted";
import { requireInstanceRole } from "./lib/instanceAccess";
import { isInstanceMember } from "./lib/teamAccess";

export interface GettingStartedState {
  doneItemIds: string[];
  dismissed: boolean;
}

async function readRow(ctx: MutationCtx, instanceId: Id<"instances">): Promise<Doc<"gettingStartedChecklists"> | null> {
  return await ctx.db
    .query("gettingStartedChecklists")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
}

/** The card's own records for an instance. Null for a non-member. */
export const state = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<GettingStartedState | null> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    const row = await ctx.db
      .query("gettingStartedChecklists")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    return { doneItemIds: row?.doneItemIds ?? [], dismissed: row?.dismissedAt !== undefined };
  },
});

/** Records an item the app cannot observe as done. */
export const markDone = mutation({
  args: { instanceId: v.id("instances"), itemId: v.string() },
  handler: async (ctx, { instanceId, itemId }) => {
    await requireInstanceRole(ctx, instanceId);
    if (!isManualGettingStartedItemId(itemId)) {
      throw new Error(`"${itemId}" is not an item the checklist records`);
    }
    const now = Date.now();
    const row = await readRow(ctx, instanceId);
    if (!row) {
      await ctx.db.insert("gettingStartedChecklists", { instanceId, doneItemIds: [itemId], updatedAt: now });
      return;
    }
    if (row.doneItemIds.includes(itemId)) {
      return;
    }
    await ctx.db.patch(row._id, { doneItemIds: [...row.doneItemIds, itemId].sort(), updatedAt: now });
  },
});

/** Hides the card for everyone on the instance. */
export const dismiss = mutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    await requireInstanceRole(ctx, instanceId);
    const now = Date.now();
    const row = await readRow(ctx, instanceId);
    if (!row) {
      await ctx.db.insert("gettingStartedChecklists", {
        instanceId,
        doneItemIds: [],
        dismissedAt: now,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(row._id, { dismissedAt: now, updatedAt: now });
  },
});
