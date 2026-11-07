import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type MutationCtx, mutation, query } from "./_generated/server";
import { PLACEHOLDER_NAME } from "./lib/firstRun";
import { deleteInstanceAndEngine } from "./lib/instanceTeardown";

const MAX_INSTANCES_PER_ACCOUNT = 20;

export const getMyAccount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();
  },
});

export const createAccount = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();
    if (existing) throw new Error("Account already exists");

    return insertAccount(ctx, userId, args.name);
  },
});

async function insertAccount(ctx: MutationCtx, userId: Id<"users">, name: string): Promise<Id<"accounts">> {
  const now = Date.now();
  const accountId = await ctx.db.insert("accounts", { name, ownerId: userId, createdAt: now });
  await ctx.db.insert("accountMembers", { accountId, userId, role: "owner", createdAt: now });
  return accountId;
}

/** The account the user owns, made under the placeholder name when they have none. */
export async function ensureOwnAccount(ctx: MutationCtx, userId: Id<"users">): Promise<Doc<"accounts">> {
  const existing = await ctx.db
    .query("accounts")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .first();
  if (existing) {
    return existing;
  }
  const account = await ctx.db.get(await insertAccount(ctx, userId, PLACEHOLDER_NAME));
  if (!account) {
    throw new Error("The account just created cannot be read");
  }
  return account;
}

/** Gives an engine-less user an account, for the form that connects their own engine. */
export const ensureMyAccount = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"accounts">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return (await ensureOwnAccount(ctx, userId))._id;
  },
});

/**
 * Deletes the caller's own account and every instance in it. Instances go one
 * at a time, each with its managed engine torn down first, so a failure part
 * way leaves an account that can be deleted again.
 */
export const deleteMyAccount = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const owned = await ctx.runQuery(internal.accounts.ownedAccountWithInstances, { userId });
    if (!owned) {
      throw new Error("No account found");
    }

    for (const instance of owned.instances) {
      await deleteInstanceAndEngine(ctx, instance);
    }
    await ctx.runMutation(internal.accounts.deleteAccountData, { accountId: owned.account._id });
  },
});

/** The account a user owns, and its instances; an account has one instance, so the bound is generous. */
export const ownedAccountWithInstances = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();
    if (!account) {
      return null;
    }
    const instances = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .take(MAX_INSTANCES_PER_ACCOUNT);
    return { account, instances };
  },
});

/** Removes the account itself once its instances are gone. */
export const deleteAccountData = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const remaining = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .first();
    if (remaining) {
      throw new Error("The account still has an instance; delete it first");
    }

    const licenses = await ctx.db
      .query("licenses")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    for (const license of licenses) {
      await ctx.db.delete(license._id);
    }

    const assignment = await ctx.db
      .query("accountPlans")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .unique();
    if (assignment) {
      await ctx.db.delete(assignment._id);
    }

    const accountMembers = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    for (const member of accountMembers) {
      await ctx.db.delete(member._id);
    }

    await ctx.db.delete(accountId);
  },
});
