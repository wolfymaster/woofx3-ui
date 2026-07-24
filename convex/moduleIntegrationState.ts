import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const TEN_MINUTES = 10 * 60 * 1000;

export const storeState = internalMutation({
  args: {
    state: v.string(),
    instanceId: v.id("instances"),
    moduleId: v.string(),
    integration: v.string(),
    redirectTo: v.string(),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("moduleIntegrationState", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const validateAndConsumeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const record = await ctx.db
      .query("moduleIntegrationState")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();

    if (!record) {
      return null;
    }
    await ctx.db.delete(record._id);
    if (Date.now() - record.createdAt > TEN_MINUTES) {
      return null;
    }

    return {
      instanceId: record.instanceId,
      moduleId: record.moduleId,
      integration: record.integration,
      redirectTo: record.redirectTo,
      data: record.data,
    };
  },
});
