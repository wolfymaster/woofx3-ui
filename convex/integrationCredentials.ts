import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * The OAuth apps woofx3 provides for first-party integrations. They are
 * product configuration, not deployment configuration, so they live here
 * rather than in environment variables. Set one from the CLI:
 *
 *   bunx convex run --prod integrationCredentials:set '{"integration":"spotify","clientId":"..."}'
 *
 * Nothing public reads this table: a client secret stored here must never
 * reach a browser.
 */

const integration = v.literal("spotify");

export const get = internalQuery({
  args: { integration },
  handler: async (ctx, args): Promise<Doc<"integrationCredentials"> | null> => {
    return ctx.db
      .query("integrationCredentials")
      .withIndex("by_integration", (q) => q.eq("integration", args.integration))
      .unique();
  },
});

export const set = internalMutation({
  args: { integration, clientId: v.string(), clientSecret: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const clientId = args.clientId.trim();
    if (!clientId) {
      throw new Error("clientId must not be empty");
    }
    const row = { integration: args.integration, clientId, clientSecret: args.clientSecret, updatedAt: Date.now() };
    const existing = await ctx.db
      .query("integrationCredentials")
      .withIndex("by_integration", (q) => q.eq("integration", args.integration))
      .unique();
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("integrationCredentials", row);
    }
  },
});

export const remove = internalMutation({
  args: { integration },
  handler: async (ctx, args): Promise<void> => {
    const existing = await ctx.db
      .query("integrationCredentials")
      .withIndex("by_integration", (q) => q.eq("integration", args.integration))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
