import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { recordOpsAudit } from "../lib/ops/audit";

/**
 * Records a read of a single user or account. A query cannot write, so the
 * HTTP handler records it after the read answers.
 */
export const recordRead = internalMutation({
  args: { actor: v.string(), action: v.string(), target: v.string(), reason: v.union(v.string(), v.null()) },
  handler: async (ctx, { actor, action, target, reason }) => {
    await recordOpsAudit(ctx, { actor, action, target, reason, result: "ok" });
  },
});

/**
 * Records an operator's action on a managed engine once it has finished.
 * The action calls the maintenance API between its own mutations, so no one
 * mutation holds the whole change; this row is written whether the action
 * succeeded or failed.
 */
export const recordEngineAction = internalMutation({
  args: {
    actor: v.string(),
    action: v.string(),
    target: v.string(),
    reason: v.string(),
    result: v.string(),
  },
  handler: async (ctx, { actor, action, target, reason, result }) => {
    await recordOpsAudit(ctx, { actor, action, target, reason, result });
  },
});
