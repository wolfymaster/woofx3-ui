import { migrations } from "./index";

/**
 * Deletes an invitation from before invitations named an engine. Nothing
 * issues those any more; once none remain the schema makes `instanceId` and
 * `engineRole` required. Idempotent: an invitation with an engine is left alone.
 */
export const deleteInvitationsWithoutEngine = migrations.define({
  table: "invitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.instanceId === undefined) {
      await ctx.db.delete(invitation._id);
    }
  },
});
