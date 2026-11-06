import { landingEngine } from "../lib/invitationEngine";
import { logger } from "../logger";
import { migrations } from "./index";

/**
 * M4: a pending invitation from before invitations named an engine gets the
 * engine `accept` would have landed it on, at its org role. One whose org has
 * no engine is expired. Orgs with several engines are reported, since the
 * choice there is a guess. Idempotent: an invitation with an engine is left alone.
 */
export const invitationEngineTarget = migrations.define({
  table: "invitations",
  migrateOne: async (ctx, invitation) => {
    if (invitation.status !== "pending" || invitation.instanceId !== undefined) {
      return;
    }
    const landing = await landingEngine(ctx, invitation.accountId);
    if (landing === null) {
      return { status: "expired" as const };
    }
    if (landing.engineCount > 1) {
      logger.warn("invitationEngineTarget: org has several engines; chose the registered one", {
        invitationId: invitation._id,
        accountId: invitation.accountId,
        instanceId: landing.instanceId,
        engineCount: landing.engineCount,
      });
    }
    return { instanceId: landing.instanceId, engineRole: invitation.role };
  },
});
