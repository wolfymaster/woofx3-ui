import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
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
 * An unknown org is 404 and claims nothing.
 */
export const applyBillingProjection = internalMutation({
  args: { accountId: v.string(), ...orgBillingFields },
  handler: async (ctx, { accountId: rawAccountId, ...projection }): Promise<ProjectionWriteResult> => {
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
    }
    await settleOpsRequest(ctx, id, { ok: true, result }, Date.now());
    return { ok: true, result };
  },
});
