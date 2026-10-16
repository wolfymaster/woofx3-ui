import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { MaintenanceApiError } from "../lib/maintenanceClient";
import { deleteManagedEngineRow, retryManagedEngineRow, upgradeManagedEngineRow } from "../lib/managedEngineActions";

export type EngineActionResult =
  | { ok: true; result: unknown }
  | { ok: false; status: 404 | 409 | 502; code: string; message: string };

/**
 * An operator's upgrade, retry or delete of a customer's managed engine. It
 * runs the same code as the customer's own action (lib/managedEngineActions.ts),
 * so the row, the runs and the callbacks are identical; the customer is not
 * told and sees the run as any other. The maintenance API's own idempotency
 * keys come from the row's state, so a repeated request is answered by the
 * run already started.
 */
export const act = internalAction({
  args: {
    instanceId: v.string(),
    action: v.union(v.literal("upgrade"), v.literal("retry"), v.literal("delete")),
    actor: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { instanceId, action, actor, reason }): Promise<EngineActionResult> => {
    const audit = (result: string) =>
      ctx.runMutation(internal.ops.audit.recordEngineAction, {
        actor,
        action: `engines.${action}`,
        target: instanceId,
        reason,
        result,
      });

    const row = await ctx.runQuery(internal.ops.reads.provisioningForInstance, { instanceId });
    if (!row) {
      await audit("not_found");
      return { ok: false, status: 404, code: "not_found", message: "This instance has no managed engine" };
    }
    try {
      const result =
        action === "upgrade"
          ? await upgradeManagedEngineRow(ctx, row, { operator: actor })
          : action === "retry"
            ? await retryManagedEngineRow(ctx, row)
            : await deleteManagedEngineRow(ctx, row);
      await audit("ok");
      return { ok: true, result };
    } catch (error) {
      if (error instanceof MaintenanceApiError) {
        await audit(`maintenance:${error.code}`);
        return { ok: false, status: 502, code: "maintenance_error", message: error.message };
      }
      await audit("refused");
      return {
        ok: false,
        status: 409,
        code: "refused",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
