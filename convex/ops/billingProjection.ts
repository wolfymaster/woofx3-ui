import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { recordOpsAudit } from "../lib/ops/audit";
import { claimOpsRequest, type OpsRequestId, requestFingerprint, settleOpsRequest } from "../lib/ops/idempotency";
import { orgBillingFields, orgBillingFor } from "../lib/orgBilling";

// The management plane's billing projection push. The projection is a read
// model: Convex stores the newest version it was sent and enforces from it.

export type ProjectionWriteResult =
  | { ok: true; result: { applied: boolean; version: number } }
  | { ok: false; status: 404 | 409; code: string; message: string };

/** The Idempotency-Key a push of `version` for `accountId` must carry. */
export function projectionIdempotencyKey(accountId: string, version: number): string {
  return `${accountId}:${version}`;
}

/**
 * Upserts the org's projection unless a version at least as new is stored
 * (`applied: false`, with the stored version). Run once per idempotency key:
 * a repeat replays the first answer, the same key with another body is 409.
 * An unknown org is 404 and claims nothing. A push that is applied is audited
 * with the operator, in the same mutation; a replay or a stale push is not.
 */
export const applyBillingProjection = internalMutation({
  args: { accountId: v.string(), actor: v.string(), auditReason: v.string(), ...orgBillingFields },
  handler: async (
    ctx,
    { accountId: rawAccountId, actor, auditReason, ...projection }
  ): Promise<ProjectionWriteResult> => {
    const accountId = ctx.db.normalizeId("accounts", rawAccountId);
    if (accountId === null || (await ctx.db.get(accountId)) === null) {
      return { ok: false, status: 404, code: "not_found", message: "No such account" };
    }
    const id: OpsRequestId = {
      write: "projection",
      accountId: rawAccountId,
      key: projectionIdempotencyKey(rawAccountId, projection.version),
    };
    const claim = await claimOpsRequest<{ applied: boolean; version: number }>(
      ctx,
      id,
      requestFingerprint(projection),
      Date.now()
    );
    if (claim.kind === "answered") {
      return claim.outcome;
    }
    const stored = await orgBillingFor(ctx, accountId);
    let result: { applied: boolean; version: number };
    if (stored !== null && stored.version >= projection.version) {
      result = { applied: false, version: stored.version };
    } else {
      const row = { accountId, ...projection, updatedAt: Date.now() };
      if (stored === null) {
        await ctx.db.insert("orgBilling", row);
      } else {
        await ctx.db.replace(stored._id, row);
      }
      result = { applied: true, version: projection.version };
      await recordOpsAudit(ctx, {
        actor,
        action: "accounts.billingProjection",
        target: rawAccountId,
        reason: auditReason,
        request: { version: projection.version, tier: projection.tier, standing: projection.standing },
        result: "ok",
      });
    }
    await settleOpsRequest(ctx, id, { ok: true, result }, Date.now());
    return { ok: true, result };
  },
});

/**
 * Sets an org's stored projection version back to 0 so the plane's next push
 * is applied, for a plane whose counter was rebuilt or an org whose stored
 * version is out of step. Every other field stays as it was, so entitlements
 * do not change until a push arrives. The org's remembered push keys are
 * forgotten too, or a re-sent version would replay its old answer instead of
 * being applied. Audited with the operator and reason.
 */
export const resetBillingProjection = internalMutation({
  args: { accountId: v.string(), actor: v.string(), auditReason: v.string() },
  handler: async (
    ctx,
    { accountId: rawAccountId, actor, auditReason }
  ): Promise<
    | { ok: true; result: { previousVersion: number; version: 0 } }
    | { ok: false; status: 404; code: string; message: string }
  > => {
    const accountId = ctx.db.normalizeId("accounts", rawAccountId);
    if (accountId === null || (await ctx.db.get(accountId)) === null) {
      return { ok: false, status: 404, code: "not_found", message: "No such account" };
    }
    const stored = await orgBillingFor(ctx, accountId);
    if (stored === null) {
      return { ok: false, status: 404, code: "no_projection", message: "The account has no stored projection" };
    }
    await ctx.db.patch(stored._id, { version: 0 });
    const claims = await ctx.db
      .query("opsRequests")
      .withIndex("by_key", (q) => q.eq("write", "projection").eq("accountId", rawAccountId))
      .collect();
    for (const claim of claims) {
      await ctx.db.delete(claim._id);
    }
    await recordOpsAudit(ctx, {
      actor,
      action: "accounts.billingProjectionReset",
      target: rawAccountId,
      reason: auditReason,
      request: { previousVersion: stored.version },
      result: "ok",
    });
    return { ok: true, result: { previousVersion: stored.version, version: 0 } };
  },
});
