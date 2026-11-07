import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type InvitedEngineRole = "admin" | "member";

/** Engines read when choosing a landing engine. Orgs hold a handful, so this is a backstop, not a page size. */
const LANDING_ENGINE_SCAN = 50;

/**
 * The engine an org-wide invitation (one from before invitations named an
 * engine) lands on: a registered engine first, in case an unfinished one
 * lingers. Null when the org has no engine. `engineCount` lets the migration
 * report orgs where the choice was not obvious.
 */
export async function landingEngine(
  ctx: QueryCtx,
  accountId: Id<"accounts">
): Promise<{ instanceId: Id<"instances">; engineCount: number } | null> {
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(LANDING_ENGINE_SCAN);
  const chosen = instances.find((instance) => instance.clientId) ?? instances[0];
  return chosen ? { instanceId: chosen._id, engineCount: instances.length } : null;
}

/** The engine and role an invitation grants, or null when its engine is gone. */
export async function invitationEngine(
  ctx: QueryCtx,
  invitation: Doc<"invitations">
): Promise<{ instanceId: Id<"instances">; engineRole: InvitedEngineRole } | null> {
  if (invitation.instanceId === undefined) {
    const landing = await landingEngine(ctx, invitation.accountId);
    return landing ? { instanceId: landing.instanceId, engineRole: invitation.role } : null;
  }
  const instance = await ctx.db.get(invitation.instanceId);
  if (instance === null) {
    return null;
  }
  if (instance.accountId !== invitation.accountId) {
    throw new Error(`Invitation ${invitation._id} names engine ${instance._id} of another organization`);
  }
  return { instanceId: instance._id, engineRole: invitation.engineRole ?? invitation.role };
}
