import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type QueryCtx } from "../_generated/server";
import { accountEntitlements } from "../lib/entitlementAccess";
import {
  HOSTED_STORAGE_LIMIT_FIELDS,
  type HostedStorageLimits,
  type HostedStorageOverride,
  hostedStorageLimits,
  hostedStorageOverrideValidator,
  isByteLimit,
} from "../lib/hostedStorage";
import { recordOpsAudit } from "../lib/ops/audit";

/**
 * An engine's hosted storage limits as operators see them: what its account's
 * entitlements give it, its own override, and the limits that apply. Whether
 * they bind depends on the engine still being on hosted storage, which only
 * the engine can say; see lib/hostedStorage.ts.
 */
export interface HostedStorageLimitsDto {
  inherited: HostedStorageLimits;
  override: HostedStorageOverride;
  effective: HostedStorageLimits;
}

export async function hostedStorageLimitsDto(
  ctx: QueryCtx,
  instance: Doc<"instances">
): Promise<HostedStorageLimitsDto> {
  const entitlements = await accountEntitlements(ctx, instance.accountId);
  const override = instance.hostedStorageLimits ?? {};
  return {
    inherited: hostedStorageLimits(entitlements),
    override,
    effective: hostedStorageLimits(entitlements, override),
  };
}

export type StorageLimitsWriteResult =
  | { ok: true; result: HostedStorageLimitsDto }
  | { ok: false; status: 404 | 409; code: string; message: string };

/**
 * Replaces one managed engine's hosted storage override; `{}` clears it. An
 * engine someone else hosts has no hosted storage, so it is refused rather
 * than given a limit nothing would check.
 */
export const set = internalMutation({
  args: {
    instanceId: v.string(),
    limits: hostedStorageOverrideValidator,
    actor: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { instanceId, limits, actor, reason }): Promise<StorageLimitsWriteResult> => {
    for (const value of HOSTED_STORAGE_LIMIT_FIELDS.map((field) => limits[field])) {
      if (value !== undefined && !isByteLimit(value)) {
        throw new Error(`Storage limits must be whole numbers of bytes of at least 0, or null; got ${value}`);
      }
    }
    const audit = (result: string) =>
      recordOpsAudit(ctx, {
        actor,
        action: "instances.setStorageLimits",
        target: instanceId,
        reason,
        request: { ...limits },
        result,
      });

    const id = ctx.db.normalizeId("instances", instanceId);
    const instance = id === null ? null : await ctx.db.get(id);
    if (id === null || instance === null) {
      await audit("not_found");
      return { ok: false, status: 404, code: "not_found", message: "No such instance" };
    }
    if (instance.hosting !== "managed") {
      await audit("not_managed");
      return {
        ok: false,
        status: 409,
        code: "not_managed",
        message: "Only a managed engine has hosted storage to limit",
      };
    }
    const cleared = HOSTED_STORAGE_LIMIT_FIELDS.every((field) => limits[field] === undefined);
    const hostedStorageLimits = cleared ? undefined : limits;
    await ctx.db.patch(id, { hostedStorageLimits });
    await audit("ok");
    return { ok: true, result: await hostedStorageLimitsDto(ctx, { ...instance, hostedStorageLimits }) };
  },
});
