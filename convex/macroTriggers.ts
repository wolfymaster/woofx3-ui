import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { loadMacroEngineContext, type MacroEngineContext, valuesFromPairs } from "./lib/macroExecution";
import {
  decideTrigger,
  fullRateBucket,
  generateTriggerToken,
  hashTriggerToken,
  type MacroRunPlan,
  macroBehaviorFingerprint,
} from "./lib/macroTrigger";
import { getInstanceMembership } from "./lib/teamAccess";

// Same sanity ceiling as the pad itself (convex/macros.ts): one trigger per macro.
const MAX_TRIGGERS = 200;

/** Longest failure reason kept on a trigger row. */
const MAX_FAILURE_LENGTH = 300;

const variablePairsValidator = v.array(v.object({ name: v.string(), value: v.string() }));

/**
 * Owners and admins. A trigger URL fires a macro with nobody signed in, so
 * minting, rotating, re-confirming and revoking one are theirs alone, and so is
 * changing what a macro with a live URL does.
 */
export async function isInstanceManager(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">
): Promise<boolean> {
  const membership = await getInstanceMembership(ctx, instanceId, userId);
  return membership?.role === "owner" || membership?.role === "admin";
}

async function requireTriggerManager(ctx: MutationCtx, instanceId: Id<"instances">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  if (!(await isInstanceManager(ctx, instanceId, userId))) {
    throw new Error("Only an instance owner or admin can manage remote triggers");
  }
  return userId;
}

export function findTriggerForMacro(ctx: QueryCtx, macroId: Id<"macros">) {
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

/** Whether the trigger's approval still stands: same behavior, approver still a manager. */
async function approvalStands(ctx: QueryCtx, trigger: Doc<"macroTriggers">, macro: Doc<"macros">): Promise<boolean> {
  if (macroBehaviorFingerprint(macro.type, macro.config) !== trigger.confirmedFingerprint) {
    return false;
  }
  return isInstanceManager(ctx, trigger.instanceId, trigger.confirmedBy);
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
    const triggers = [];
    for (const row of rows) {
      const macro = await ctx.db.get(row.macroId);
      if (!macro) {
        continue;
      }
      triggers.push({
        macroId: row.macroId,
        allowGet: row.allowGet,
        createdAt: row.createdAt,
        rotatedAt: row.rotatedAt,
        lastUsedAt: row.lastUsedAt,
        useCount: row.useCount,
        lastFailedAt: row.lastFailedAt,
        lastFailure: row.lastFailure,
        needsConfirmation: !(await approvalStands(ctx, row, macro)),
      });
    }
    return {
      canManage: membership.role === "owner" || membership.role === "admin",
      triggers,
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
    if (!(await isInstanceManager(ctx, instanceId, userId))) {
      throw new Error("Only an instance owner or admin can manage remote triggers");
    }
    const macro = await ctx.db.get(macroId);
    if (!macro || macro.instanceId !== instanceId) {
      throw new Error("Macro not found");
    }
    if (macro.type === "http-request") {
      throw new Error("HTTP request macros run in the browser and cannot have a remote trigger");
    }

    // Minting approves the macro as it stands now.
    const now = Date.now();
    const approval = {
      confirmedFingerprint: macroBehaviorFingerprint(macro.type, macro.config),
      confirmedBy: userId,
      confirmedAt: now,
    };
    const existing = await findTriggerForMacro(ctx, macroId);
    if (existing) {
      // Replacing the hash is the whole rotation: the old URL stops matching
      // in the same transaction the new one starts to.
      await ctx.db.patch(existing._id, { tokenHash, rotatedAt: now, ...approval });
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
      ...approval,
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

/**
 * Approve what the macro does now, keeping its URL. Needed after the macro's
 * action changes, or after whoever last approved it stops being an owner or
 * admin; until then the URL answers 409.
 */
export const reconfirm = mutation({
  args: { instanceId: v.id("instances"), macroId: v.id("macros") },
  handler: async (ctx, { instanceId, macroId }) => {
    const userId = await requireTriggerManager(ctx, instanceId);
    const trigger = await findTriggerForMacro(ctx, macroId);
    const macro = await ctx.db.get(macroId);
    if (!trigger || trigger.instanceId !== instanceId || !macro || macro.instanceId !== instanceId) {
      throw new Error("This macro has no remote trigger");
    }
    await ctx.db.patch(trigger._id, {
      confirmedFingerprint: macroBehaviorFingerprint(macro.type, macro.config),
      confirmedBy: userId,
      confirmedAt: Date.now(),
    });
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
  | { outcome: "run"; triggerId: Id<"macroTriggers">; plan: MacroRunPlan; engine: MacroEngineContext };

/**
 * Everything the trigger route decides before it calls the engine, in one
 * transaction: find the trigger by token hash, check the method, spend a
 * rate-limit token, check the approval still stands, and plan the run. The
 * route reports how the engine answered through recordOutcome.
 *
 * An unknown hash, a revoked trigger, and a trigger whose macro or instance
 * is gone or whose instance is not registered with an engine all answer the
 * same `not-found`, before anything is written, so the route cannot tell a
 * caller which of them it hit.
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
    const engine = await loadMacroEngineContext(ctx, trigger.instanceId);
    const live = macro !== null && macro.instanceId === trigger.instanceId && engine !== null;

    const decision = decideTrigger({
      trigger: {
        allowGet: trigger.allowGet,
        bucket: { tokens: trigger.rateTokens, refilledAt: trigger.rateRefilledAt },
        confirmedFingerprint: trigger.confirmedFingerprint,
        confirmerIsManager: await isInstanceManager(ctx, trigger.instanceId, trigger.confirmedBy),
      },
      macro: live ? macro : null,
      method,
      values: valuesFromPairs(values),
      now: Date.now(),
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

    if (engine === null) {
      throw new Error("claim: a trigger that decided to run must have an engine context");
    }
    if (decision.plan.kind === "chat-command" && !engine.broadcasterLogin) {
      return { outcome: "refused", status: 409, error: "link a Twitch account before running chat-command macros" };
    }
    return { outcome: "run", triggerId: trigger._id, plan: decision.plan, engine };
  },
});

/** How the engine answered a claimed run. Only accepted runs count as uses. */
export const recordOutcome = internalMutation({
  args: {
    triggerId: v.id("macroTriggers"),
    failure: v.optional(v.string()),
  },
  handler: async (ctx, { triggerId, failure }) => {
    const trigger = await ctx.db.get(triggerId);
    if (!trigger) {
      return;
    }
    const now = Date.now();
    if (failure === undefined) {
      await ctx.db.patch(triggerId, { lastUsedAt: now, useCount: trigger.useCount + 1 });
      return;
    }
    await ctx.db.patch(triggerId, { lastFailedAt: now, lastFailure: failure.slice(0, MAX_FAILURE_LENGTH) });
  },
});
