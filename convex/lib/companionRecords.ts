import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { MAX_ENDPOINT_ROWS_PER_COMPANION, scheduleRelaySync } from "./companionEndpoints";

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

/**
 * Deleting the row is the revocation: the companion's token stops
 * authenticating at once, and it can no longer mint relay credentials. Its
 * endpoint rows go with it, since they describe what that companion does, and
 * the engine is told at once to stop dialing its bridge. Revoking, unpairing
 * and replacing a companion all come through here.
 */
export async function deleteCompanion(ctx: MutationCtx, companionId: Id<"companions">): Promise<void> {
  const companion = await ctx.db.get(companionId);
  if (!companion) {
    return;
  }
  await deleteCompanionPresence(ctx, companionId);
  const endpoints = await ctx.db
    .query("companionEndpoints")
    .withIndex("by_companion", (q) => q.eq("companionId", companionId))
    .take(MAX_ENDPOINT_ROWS_PER_COMPANION);
  for (const row of endpoints) {
    await ctx.db.delete(row._id);
  }
  await ctx.db.delete(companionId);
  if (endpoints.some((row) => row.enabled)) {
    await scheduleRelaySync(ctx, companion.instanceId);
  }
}

/** How the companion names the person who approved it, so the person at the PC can recognise them. */
export function approverDisplayName(user: Doc<"users"> | null): string {
  return user?.name ?? user?.email ?? "an instance admin";
}
