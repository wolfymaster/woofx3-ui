import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * The OAuth apps woofx3 provides for first-party integrations, one per
 * provider in `PLATFORM_OAUTH_PROVIDERS` (lib/integrationClientId.ts), whose
 * redirect URL must be the module OAuth callback (`OAUTH_CALLBACK_PATHS.module`).
 * They are product configuration, not deployment configuration, so they live
 * here rather than in environment variables. Set one from the CLI:
 *
 *   bunx convex run --prod integrationCredentials:set '{"integration":"spotify","clientId":"..."}'
 *
 * Nothing public reads this table: a client secret stored here must never
 * reach a browser.
 */

const integration = v.literal("spotify");

/** The client id of each app woofx3 provides, by integration. */
export const clientIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Partial<Record<Doc<"integrationCredentials">["integration"], string>>> => {
    const rows = await ctx.db.query("integrationCredentials").collect();
    return Object.fromEntries(rows.map((row) => [row.integration, row.clientId]));
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
