import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx, mutation } from "./_generated/server";
import { hashOpaqueToken, isOpaqueToken, signInNonceMatches } from "./lib/oauthHandoff";
import { safeRelativePath } from "./lib/safeRedirect";
import {
  type DesktopSignInClaim,
  type DesktopSignInOutcome,
  desktopSignInClaimValidator,
  oauthErrorCodeValidator,
  signInClientValidator,
  TWITCH_PENDING_SIGN_IN_TTL_MS,
  TWITCH_SIGN_IN_STATE_TTL_MS,
} from "./lib/twitchSignIn";

/**
 * "nonce_in_use" refuses a desktop sign-in whose nonce hash another sign-in
 * already holds. The hash travels in the system browser's address bar, and
 * a second sign-in started with it could otherwise leave a different Twitch
 * account's outcome for the app to claim.
 */
export const storeState = internalMutation({
  args: {
    state: v.string(),
    redirectTo: v.string(),
    instanceId: v.optional(v.id("instances")),
    userId: v.optional(v.id("users")),
    nonceHash: v.optional(v.string()),
    signInClient: v.optional(signInClientValidator),
  },
  returns: v.union(v.literal("stored"), v.literal("nonce_in_use")),
  handler: async (ctx, { state, redirectTo, instanceId, userId, nonceHash, signInClient }) => {
    if ((instanceId === undefined) !== (userId === undefined)) {
      throw new Error("An integration connect needs both the instance and the user who started it");
    }
    if ((instanceId === undefined) === (nonceHash === undefined)) {
      throw new Error("A sign-in needs a nonce hash and an integration connect must not have one");
    }
    if ((nonceHash === undefined) !== (signInClient === undefined)) {
      throw new Error("A sign-in names the client finishing it and an integration connect must not");
    }
    if (signInClient === "desktop" && nonceHash !== undefined && (await desktopNonceHashInUse(ctx, nonceHash))) {
      return "nonce_in_use";
    }
    const id = await ctx.db.insert("twitchOAuthState", {
      state,
      // The callback page navigates here after Twitch answers.
      redirectTo: safeRelativePath(redirectTo),
      instanceId,
      userId,
      nonceHash,
      signInClient,
      createdAt: Date.now(),
    });
    // A flow abandoned on Twitch's page never reaches the callback that deletes it.
    await ctx.scheduler.runAfter(TWITCH_SIGN_IN_STATE_TTL_MS, internal.twitchAuth.expireState, { id });
    return "stored";
  },
});

async function desktopNonceHashInUse(ctx: MutationCtx, nonceHash: string): Promise<boolean> {
  const state = await ctx.db
    .query("twitchOAuthState")
    .withIndex("by_nonce_hash", (q) => q.eq("nonceHash", nonceHash))
    .first();
  if (state !== null) {
    return true;
  }
  const outcome = await ctx.db
    .query("twitchDesktopSignIns")
    .withIndex("by_nonce_hash", (q) => q.eq("nonceHash", nonceHash))
    .first();
  return outcome !== null;
}

export const expireState = internalMutation({
  args: { id: v.id("twitchOAuthState") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) {
      await ctx.db.delete(id);
    }
  },
});

export const validateAndConsumeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const record = await ctx.db
      .query("twitchOAuthState")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();

    if (!record) {
      return null;
    }
    await ctx.db.delete(record._id);
    if (Date.now() - record.createdAt > TWITCH_SIGN_IN_STATE_TTL_MS) {
      return null;
    }

    const nonceHash = record.nonceHash ?? null;
    return {
      redirectTo: record.redirectTo,
      instanceId: record.instanceId ?? null,
      userId: record.userId ?? null,
      nonceHash,
      signInClient: nonceHash === null ? null : (record.signInClient ?? "web"),
    };
  },
});

export const storePendingAuth = internalMutation({
  args: {
    twitchId: v.string(),
    displayName: v.string(),
    email: v.string(),
    profileImage: v.string(),
    nonceHash: v.string(),
    signInClient: signInClientValidator,
  },
  handler: async (ctx, { signInClient, ...profile }): Promise<string> => {
    const token = crypto.randomUUID();
    const createdAt = Date.now();
    const id = await ctx.db.insert("twitchPendingAuth", { token, createdAt, ...profile });
    // The row holds the Twitch profile, email included; an unclaimed sign-in
    // must not keep it.
    await ctx.scheduler.runAfter(TWITCH_PENDING_SIGN_IN_TTL_MS, internal.twitchAuth.expirePendingAuth, { id });
    if (signInClient === "desktop") {
      await insertDesktopOutcome(ctx, profile.nonceHash, { kind: "signed_in", token }, createdAt);
    }
    return token;
  },
});

/** A desktop sign-in that Twitch or the callback refused, for the app to report instead of waiting out its time. */
export const storeDesktopSignInFailure = internalMutation({
  args: { nonceHash: v.string(), error: oauthErrorCodeValidator },
  returns: v.null(),
  handler: async (ctx, { nonceHash, error }) => {
    await insertDesktopOutcome(ctx, nonceHash, { kind: "failed", error }, Date.now());
    return null;
  },
});

async function insertDesktopOutcome(
  ctx: MutationCtx,
  nonceHash: string,
  outcome: DesktopSignInOutcome,
  createdAt: number
): Promise<void> {
  const id = await ctx.db.insert("twitchDesktopSignIns", { nonceHash, outcome, createdAt });
  await ctx.scheduler.runAfter(TWITCH_PENDING_SIGN_IN_TTL_MS, internal.twitchAuth.expireDesktopSignIn, { id });
}

export const expireDesktopSignIn = internalMutation({
  args: { id: v.id("twitchDesktopSignIns") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) {
      await ctx.db.delete(id);
    }
  },
});

/**
 * The desktop app asks, with the nonce it started a sign-in with, how that
 * sign-in ended. Public because the app is not signed in yet: the nonce is
 * the capability, and only its hash is stored. An outcome is handed out
 * once; the token it carries then still needs the same nonce to sign in
 * (`lookupPendingAuth`).
 */
export const claimDesktopSignIn = mutation({
  args: { nonce: v.string() },
  returns: desktopSignInClaimValidator,
  handler: async (ctx, { nonce }): Promise<DesktopSignInClaim> => {
    if (!isOpaqueToken(nonce)) {
      return { status: "pending" };
    }
    const nonceHash = await hashOpaqueToken(nonce);
    const record = await ctx.db
      .query("twitchDesktopSignIns")
      .withIndex("by_nonce_hash", (q) => q.eq("nonceHash", nonceHash))
      .first();
    if (record === null) {
      return { status: "pending" };
    }
    await ctx.db.delete(record._id);
    if (Date.now() - record.createdAt > TWITCH_PENDING_SIGN_IN_TTL_MS) {
      return { status: "expired" };
    }
    if (record.outcome.kind === "signed_in") {
      return { status: "signed_in", token: record.outcome.token };
    }
    return { status: "failed", error: record.outcome.error };
  },
});

export const expirePendingAuth = internalMutation({
  args: { id: v.id("twitchPendingAuth") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) {
      await ctx.db.delete(id);
    }
  },
});

/**
 * Redeems a pending sign-in once. The row is deleted on every attempt, and
 * the profile is released only to the browser presenting the nonce the
 * sign-in started with, so a callback link completed elsewhere signs nobody in.
 */
export const lookupPendingAuth = internalMutation({
  args: { token: v.string(), nonceHash: v.string() },
  handler: async (ctx, { token, nonceHash }) => {
    const record = await ctx.db
      .query("twitchPendingAuth")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!record) {
      return null;
    }
    await ctx.db.delete(record._id);
    if (Date.now() - record.createdAt > TWITCH_PENDING_SIGN_IN_TTL_MS) {
      return null;
    }
    if (!signInNonceMatches(record.nonceHash, nonceHash)) {
      return null;
    }

    return {
      twitchId: record.twitchId,
      displayName: record.displayName,
      email: record.email,
      profileImage: record.profileImage,
    };
  },
});

export const deleteOrphanedAuthAccount = internalMutation({
  args: { providerAccountId: v.string() },
  handler: async (ctx, { providerAccountId }) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "twitch").eq("providerAccountId", providerAccountId))
      .unique();

    if (!account) {
      return;
    }

    const user = await ctx.db.get(account.userId);

    if (user !== null) {
      return;
    }

    console.log("deleting orphaned authAccount for", providerAccountId);
    await ctx.db.delete(account._id);
  },
});

export const deletePendingAuth = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const record = await ctx.db
      .query("twitchPendingAuth")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (record) {
      await ctx.db.delete(record._id);
    }
  },
});
