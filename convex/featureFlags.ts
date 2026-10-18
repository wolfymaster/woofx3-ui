import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { featureFlagSubject, instanceFeatureFlagSubject, isFeatureFlagOn } from "./lib/featureFlagAccess";
import {
  FEATURE_FLAGS,
  type FeatureFlagDefinition,
  type FeatureFlagKey,
  featureFlagRulesValidator,
  featureFlagStateValidator,
  isFeatureFlagKey,
  isFlagOn,
  validateFeatureFlagRules,
} from "./lib/featureFlags";

/**
 * Every known flag's answer for the signed-in user on an instance. Flags are
 * few, so one subscription answers the whole page and updates as soon as an
 * operator changes a row.
 */
export const forViewer = query({
  args: { instanceId: v.optional(v.id("instances")) },
  handler: async (ctx, { instanceId }): Promise<Record<FeatureFlagKey, boolean>> => {
    const keys = Object.keys(FEATURE_FLAGS);
    const userId = await getAuthUserId(ctx);
    const subject = userId ? await featureFlagSubject(ctx, userId, instanceId) : null;
    const answers: Record<string, boolean> = {};
    for (const key of keys) {
      if (subject === null) {
        answers[key] = false;
        continue;
      }
      const row = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      answers[key] = isFlagOn(row, subject);
    }
    return answers as Record<FeatureFlagKey, boolean>;
  },
});

/**
 * Whether a flag is on for an instance, for server code that routes work by
 * flag without a signed-in user. Off for an unknown key or instance.
 */
export const isOnForInstance = internalQuery({
  args: { key: v.string(), instanceId: v.id("instances") },
  handler: async (ctx, { key, instanceId }): Promise<boolean> => {
    if (!isFeatureFlagKey(key)) {
      return false;
    }
    const subject = await instanceFeatureFlagSubject(ctx, instanceId);
    return subject !== null && (await isFeatureFlagOn(ctx, key, subject));
  },
});

/**
 * Sets a flag's targeting. Operator-only, run from the CLI:
 *
 *   bunx convex run featureFlags:set '{"key": "…", "state": "rules", "rules": {"percent": 10}}'
 */
export const set = internalMutation({
  args: {
    key: v.string(),
    state: featureFlagStateValidator,
    rules: v.optional(featureFlagRulesValidator),
  },
  handler: async (ctx, { key, state, rules }) => {
    if (!isFeatureFlagKey(key)) {
      throw new Error(`Unknown feature flag "${key}"; add it to FEATURE_FLAGS first`);
    }
    if (state === "rules" && rules === undefined) {
      throw new Error('state "rules" needs rules');
    }
    if (state !== "rules" && rules !== undefined) {
      throw new Error(`state "${state}" ignores rules; set state "rules" to target`);
    }
    if (rules !== undefined) {
      validateFeatureFlagRules(rules);
    }
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const row = { key, state, rules, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("featureFlags", row);
    }
  },
});

/** Deletes a flag's row, e.g. after its key is removed from FEATURE_FLAGS. */
export const remove = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Every known flag with its row, plus rows for keys no longer known. A flag
 * past its removeBy date, or an orphaned row, is cleanup to do.
 */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("featureFlags").take(500);
    const today = new Date().toISOString().slice(0, 10);
    const definitions: Record<string, FeatureFlagDefinition> = FEATURE_FLAGS;
    const known = Object.entries(definitions).map(([key, definition]) => ({
      key,
      ...definition,
      overdue: definition.removeBy < today,
      row: rows.find((row) => row.key === key) ?? null,
    }));
    const orphaned = rows.filter((row) => !isFeatureFlagKey(row.key)).map((row) => row.key);
    return { known, orphaned };
  },
});
