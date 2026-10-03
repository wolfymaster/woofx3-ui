import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Presence rows hold one per companion; the bound only guards against a duplicate slipping in. */
const MAX_PRESENCE_ROWS_PER_COMPANION = 10;

export async function deleteCompanionPresence(ctx: MutationCtx, companionId: Id<"companions">): Promise<void> {
  const rows = await ctx.db
    .query("companionPresence")
    .withIndex("by_companion", (q) => q.eq("companionId", companionId))
    .take(MAX_PRESENCE_ROWS_PER_COMPANION);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

/** Deleting the row is the revocation: the companion's token stops authenticating at once. */
export async function deleteCompanion(ctx: MutationCtx, companionId: Id<"companions">): Promise<void> {
  await deleteCompanionPresence(ctx, companionId);
  await ctx.db.delete(companionId);
}

/** How the companion names the person who approved it, so the person at the PC can recognise them. */
export function approverDisplayName(user: Doc<"users"> | null): string {
  return user?.name ?? user?.email ?? "an instance admin";
}
