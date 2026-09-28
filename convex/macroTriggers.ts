import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { loadMacroEngineContext, type MacroEngineContext, valuesFromPairs } from "./lib/macroExecution";
import {
  decideTrigger,
  fullRateBucket,
  generateTriggerToken,
  hashTriggerToken,
  type MacroRunPlan,
} from "./lib/macroTrigger";
import { getInstanceMembership } from "./lib/teamAccess";

// Same sanity ceiling as the pad itself (convex/macros.ts): one trigger per macro.
const MAX_TRIGGERS = 200;

const variablePairsValidator = v.array(v.object({ name: v.string(), value: v.string() }));

/**
 * A trigger URL fires a macro with nobody signed in, so minting, rotating and
 * revoking one is limited to the instance's owners and admins.
 */
async function canManageTriggers(ctx: QueryCtx, instanceId: Id<"instances">, userId: Id<"users">): Promise<boolean> {
  const membership = await getInstanceMembership(ctx, instanceId, userId);
  return membership?.role === "owner" || membership?.role === "admin";
}

async function requireTriggerManager(ctx: MutationCtx, instanceId: Id<"instances">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  if (!(await canManageTriggers(ctx, instanceId, userId))) {
    throw new Error("Only an instance owner or admin can manage remote triggers");
  }
  return userId;
}

function findTriggerForMacro(ctx: QueryCtx, macroId: Id<"macros">) {
  return ctx.db
    .query("macroTriggers")
    .withIndex("by_macro", (q) => q.eq("macroId", macroId))
    .first();
}

/** Remove a macro's trigger. The macro delete cascade calls this so no orphaned URL stays live. */
export async function deleteTriggerForMacro(ctx: MutationCtx, macroId: Id<"macros">): Promise<void> {
  const trigger = await findTriggerForMacro(ctx, macroId);
  if (trigger) {
    await ctx.db.delete(trigger._id);
  }
}

/**
 * Trigger status for every macro on the instance, for the pad and the editor.
 * Never includes the token hash. A non-member sees nothing, like macros.list.
 */
export const listForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { canManage: false, triggers: [] };
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return { canManage: false, triggers: [] };
    }
    const rows = await ctx.db
      .query("macroTriggers")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(MAX_TRIGGERS);
    return {
      canManage: membership.role === "owner" || membership.role === "admin",
      triggers: rows.map((row) => ({
        macroId: row.macroId,
        allowGet: row.allowGet,
        createdAt: row.createdAt,
        rotatedAt: row.rotatedAt,
        lastUsedAt: row.lastUsedAt,
        useCount: row.useCount,
      })),
    };
  },
});

export const storeTokenHash = internalMutation({
  args: {
    instanceId: v.id("instances"),
    macroId: v.id("macros"),
    userId: v.id("users"),
    tokenHash: v.string(),
  },
  handler: async (ctx, { instanceId, macroId, userId, tokenHash }) => {
    if (!(await canManageTriggers(ctx, instanceId, userId))) {
      throw new Error("Only an instance owner or admin can manage remote triggers");
    }
    const macro = await ctx.db.get(macroId);
    if (!macro || macro.instanceId !== instanceId) {
      throw new Error("Macro not found");
    }
    if (macro.type === "http-request") {
      throw new Error("HTTP request macros run in the browser and cannot have a remote trigger");
    }

    const now = Date.now();
    const existing = await findTriggerForMacro(ctx, macroId);
    if (existing) {
      // Replacing the hash is the whole rotation: the old URL stops matching
      // in the same transaction the new one starts to.
      await ctx.db.patch(existing._id, { tokenHash, rotatedAt: now });
      return;
    }
    await ctx.db.insert("macroTriggers", {
      instanceId,
      macroId,
      tokenHash,
      allowGet: false,
      createdBy: userId,
      createdAt: now,
      useCount: 0,
      ...rateBucketFields(fullRateBucket(now)),
    });
  },
});

/**
 * Mint a trigger token for a macro, replacing any it already has, and return
 * it. This is the only time the token exists outside the caller's device:
 * only its hash is kept. An action because a mutation's randomness is seeded
 * for replay and must not produce a secret.
 */
export const issueToken = action({
  args: { instanceId: v.id("instances"), macroId: v.id("macros") },
  handler: async (ctx, { instanceId, macroId }): Promise<{ token: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const token = generateTriggerToken();
    const tokenHash = await hashTriggerToken(token);
    await ctx.runMutation(internal.macroTriggers.storeTokenHash, { instanceId, macroId, userId, tokenHash });
    return { token };
  },
});

export const revoke = mutation({
  args: { instanceId: v.id("instances"), macroId: v.id("macros") },
  handler: async (ctx, { instanceId, macroId }) => {
    await requireTriggerManager(ctx, instanceId);
    const trigger = await findTriggerForMacro(ctx, macroId);
    if (!trigger || trigger.instanceId !== instanceId) {
      return;
    }
    await ctx.db.delete(trigger._id);
  },
});

export const setAllowGet = mutation({
  args: { instanceId: v.id("instances"), macroId: v.id("macros"), allowGet: v.boolean() },
  handler: async (ctx, { instanceId, macroId, allowGet }) => {
    await requireTriggerManager(ctx, instanceId);
    const trigger = await findTriggerForMacro(ctx, macroId);
    if (!trigger || trigger.instanceId !== instanceId) {
      throw new Error("This macro has no remote trigger");
    }
    await ctx.db.patch(trigger._id, { allowGet });
  },
});

function rateBucketFields(bucket: { tokens: number; refilledAt: number }) {
  return { rateTokens: bucket.tokens, rateRefilledAt: bucket.refilledAt };
}

export type ClaimResult =
  | { outcome: "not-found" }
  | { outcome: "method-not-allowed" }
  | { outcome: "rate-limited"; retryAfterMs: number }
  | { outcome: "refused"; status: number; error: string }
  | { outcome: "run"; plan: MacroRunPlan; engine: MacroEngineContext };

/**
 * Everything the trigger route decides before it calls the engine, in one
 * transaction: find the trigger by token hash, check the method, spend a
 * rate-limit token, and plan the run. Usage is stamped only on a run that
 * reaches the engine call.
 *
 * An unknown hash, a trigger whose macro or instance is gone, and a revoked
 * trigger all answer the same `not-found`, so the route cannot tell a caller
 * which of them it hit.
 */
export const claim = internalMutation({
  args: {
    tokenHash: v.string(),
    method: v.union(v.literal("GET"), v.literal("POST")),
    values: variablePairsValidator,
  },
  handler: async (ctx, { tokenHash, method, values }): Promise<ClaimResult> => {
    const trigger = await ctx.db
      .query("macroTriggers")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!trigger) {
      return { outcome: "not-found" };
    }
    const macro = await ctx.db.get(trigger.macroId);
    const now = Date.now();
    const decision = decideTrigger({
      trigger: {
        allowGet: trigger.allowGet,
        bucket: { tokens: trigger.rateTokens, refilledAt: trigger.rateRefilledAt },
      },
      macro: macro && macro.instanceId === trigger.instanceId ? macro : null,
      method,
      values: valuesFromPairs(values),
      now,
    });
    if ("bucket" in decision) {
      await ctx.db.patch(trigger._id, rateBucketFields(decision.bucket));
    }
    switch (decision.outcome) {
      case "not-found":
      case "method-not-allowed": {
        return { outcome: decision.outcome };
      }
      case "rate-limited": {
        return { outcome: "rate-limited", retryAfterMs: decision.retryAfterMs };
      }
      case "refused": {
        return { outcome: "refused", status: decision.status, error: decision.error };
      }
      case "run": {
        break;
      }
    }

    const engine = await loadMacroEngineContext(ctx, trigger.instanceId);
    if (!engine) {
      return { outcome: "refused", status: 503, error: "this instance is not connected to its engine" };
    }
    if (decision.plan.kind === "chat-command" && !engine.broadcasterLogin) {
      return { outcome: "refused", status: 409, error: "link a Twitch account before running chat-command macros" };
    }

    await ctx.db.patch(trigger._id, { lastUsedAt: now, useCount: trigger.useCount + 1 });
    return { outcome: "run", plan: decision.plan, engine };
  },
});
