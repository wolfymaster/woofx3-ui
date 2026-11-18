import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { recordOpsAudit } from "../lib/ops/audit";
import { orgBillingFields } from "../lib/orgBilling";
import { orgBillingRow } from "../org/billing";

// The management plane's billing projection push. The projection is a read
// model: Convex stores the newest version it was sent and enforces from it.

export type ProjectionWriteResult =
  | { ok: true; result: { applied: boolean; version: number } }
  | { ok: false; status: 404 | 409; code: string; message: string };

/** Canonical JSON, keys sorted, so a stored row and a push compare equal when their fields do. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    typeof field === "object" && field !== null && !Array.isArray(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => (a < b ? -1 : 1)))
      : field
  );
}

function sameProjection(stored: Doc<"orgBilling">, projection: object): boolean {
  const { _id, _creationTime, accountId, updatedAt, ...fields } = stored;
  return canonical(fields) === canonical(projection);
}

/**
 * Upserts the org's projection unless a version at least as new is stored
 * (`applied: false`, with the stored version). A repeat of the stored version
 * with the same body is `applied: false`; the same version with another body is
 * 409 `version_conflict`, which the plane must not retry. An unknown org is
 * 404. A push that is applied is audited with the operator, in the same
 * mutation; a repeat or a stale push is not.
 */
export const applyBillingProjection = internalMutation({
  args: { accountId: v.string(), caller: v.string(), actor: v.string(), auditReason: v.string(), ...orgBillingFields },
  handler: async (
    ctx,
    { accountId: rawAccountId, caller, actor, auditReason, ...projection }
  ): Promise<ProjectionWriteResult> => {
    const accountId = ctx.db.normalizeId("accounts", rawAccountId);
    if (accountId === null || (await ctx.db.get(accountId)) === null) {
      return { ok: false, status: 404, code: "not_found", message: "No such account" };
    }
    const stored = await orgBillingRow(ctx, accountId);
    let result: { applied: boolean; version: number };
    if (stored !== null && stored.version === projection.version && !sameProjection(stored, projection)) {
      return {
        ok: false,
        status: 409,
        code: "version_conflict",
        message: "This version is already stored with different contents; send a higher version",
      };
    }
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
        caller,
        actor,
        action: "accounts.billingProjection",
        target: rawAccountId,
        reason: auditReason,
        request: { version: projection.version, tier: projection.tier, standing: projection.standing },
        result: "ok",
      });
    }
    return { ok: true, result };
  },
});

/**
 * Sets an org's stored projection version back to 0 so the plane's next push
 * is applied, for a plane whose counter was rebuilt or an org whose stored
 * version is out of step. Every other field stays as it was, so entitlements
 * do not change until a push arrives. Audited with the operator and reason.
 */
export const resetBillingProjection = internalMutation({
  args: { accountId: v.string(), caller: v.string(), actor: v.string(), auditReason: v.string() },
  handler: async (
    ctx,
    { accountId: rawAccountId, caller, actor, auditReason }
  ): Promise<
    | { ok: true; result: { previousVersion: number; version: 0 } }
    | { ok: false; status: 404; code: string; message: string }
  > => {
    const accountId = ctx.db.normalizeId("accounts", rawAccountId);
    if (accountId === null || (await ctx.db.get(accountId)) === null) {
      return { ok: false, status: 404, code: "not_found", message: "No such account" };
    }
    const stored = await orgBillingRow(ctx, accountId);
    if (stored === null) {
      return { ok: false, status: 404, code: "no_projection", message: "The account has no stored projection" };
    }
    await ctx.db.patch(stored._id, { version: 0 });
    await recordOpsAudit(ctx, {
      caller,
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
