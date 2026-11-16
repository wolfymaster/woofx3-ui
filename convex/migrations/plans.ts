import { migrations } from "./index";

/**
 * Unsets `isDefault` on plan rows written before tiers replaced the default
 * plan. Once no row has it, the schema drops the field. Idempotent.
 */
export const unsetPlanIsDefault = migrations.define({
  table: "plans",
  migrateOne: async (ctx, plan) => {
    if (plan.isDefault !== undefined) {
      await ctx.db.patch(plan._id, { isDefault: undefined });
    }
  },
});
