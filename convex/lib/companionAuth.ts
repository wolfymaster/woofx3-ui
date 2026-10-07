import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { hashCompanionToken, isCompanionToken } from "./companionCodes";
import { roleSatisfies } from "./instanceRoles";
import { getInstanceMembership } from "./teamAccess";

/**
 * Authentication for functions a paired companion calls with its token
 * rather than a user session. The companions row is the credential, so a
 * token whose hash has no row is not paired, and every helper fails closed.
 */

/** The row a token's hash names, whether or not its approval still stands. */
export async function rowByToken(ctx: QueryCtx, token: string): Promise<Doc<"companions"> | null> {
  if (!isCompanionToken(token)) {
    return null;
  }
  const tokenHash = await hashCompanionToken(token);
  return ctx.db
    .query("companions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .first();
}

/**
 * Whether the person who approved the pairing may still bind devices to the
 * instance. A companion acts on the instance with its approver's authority,
 * so removing that person or lowering them below admin unpairs it, as it does
 * for remote macro triggers (`approvalStands` in macroTriggers.ts).
 */
export async function approvalStands(ctx: QueryCtx, companion: Doc<"companions">): Promise<boolean> {
  const membership = await getInstanceMembership(ctx, companion.instanceId, companion.pairedBy);
  return roleSatisfies(membership?.role, "admin");
}

/** The companion a token authenticates, or null when it is not, or no longer, paired. */
export async function companionByToken(ctx: QueryCtx, token: string): Promise<Doc<"companions"> | null> {
  const companion = await rowByToken(ctx, token);
  if (!companion || !(await approvalStands(ctx, companion))) {
    return null;
  }
  return companion;
}

/** A paired companion the person at the PC has confirmed; integrations need both. */
export async function confirmedCompanionByToken(ctx: QueryCtx, token: string): Promise<Doc<"companions"> | null> {
  const companion = await companionByToken(ctx, token);
  return companion?.confirmedAt !== undefined ? companion : null;
}
