import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type InvitedEngineRole = "admin" | "member";

/** The engine and role an invitation grants, or null when its engine is gone. */
export async function invitationEngine(
  ctx: QueryCtx,
  invitation: Doc<"invitations">
): Promise<{ instanceId: Id<"instances">; engineRole: InvitedEngineRole } | null> {
  const instance = await ctx.db.get(invitation.instanceId);
  if (instance === null) {
    return null;
  }
  if (instance.accountId !== invitation.accountId) {
    throw new Error(`Invitation ${invitation._id} names engine ${instance._id} of another organization`);
  }
  return { instanceId: instance._id, engineRole: invitation.engineRole };
}
