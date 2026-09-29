import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { safeRelativePath } from "./lib/safeRedirect";

const TEN_MINUTES = 10 * 60 * 1000;

export const storeState = internalMutation({
  args: {
    state: v.string(),
    instanceId: v.id("instances"),
    moduleId: v.string(),
    integration: v.string(),
    redirectTo: v.string(),
    userId: v.id("users"),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("moduleIntegrationState", {
      ...args,
      // The callback redirects here after the provider answers.
      redirectTo: safeRelativePath(args.redirectTo, "/modules"),
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
      userId: record.userId ?? null,
      data: record.data,
    };
  },
});
