import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { safeRelativePath } from "./lib/safeRedirect";
import {
  VIEWER_HANDOFF_TTL_MS,
  VIEWER_LOGIN_STATE_TTL_MS,
  viewerLoginStateUsable,
  viewerPlatformValidator,
} from "./lib/viewerAuth";

// The writes behind the viewer sign-in routes in viewerAuthHttp.ts. All
// internal: only those routes call them, after checking what the browser sent.

const SHA256_HEX = /^[0-9a-f]{64}$/;

function assertSha256Hex(value: string, name: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 hex digest`);
  }
}

export const storeLoginState = internalMutation({
  args: {
    stateHash: v.string(),
    platform: viewerPlatformValidator,
    returnOrigin: v.string(),
    returnPath: v.string(),
    nonceHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertSha256Hex(args.stateHash, "stateHash");
    assertSha256Hex(args.nonceHash, "nonceHash");
    if (new URL(args.returnOrigin).origin !== args.returnOrigin) {
      throw new Error("returnOrigin must be a bare origin");
    }
    const id = await ctx.db.insert("viewerLoginStates", {
      ...args,
      returnPath: safeRelativePath(args.returnPath),
      createdAt: Date.now(),
    });
    // A login abandoned on the consent page never reaches the callback that deletes it.
    await ctx.scheduler.runAfter(VIEWER_LOGIN_STATE_TTL_MS, internal.viewerLogin.expireLoginState, { id });
    return null;
  },
});

export const expireLoginState = internalMutation({
  args: { id: v.id("viewerLoginStates") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) {
      await ctx.db.delete(id);
    }
    return null;
  },
});

const consumedLoginValidator = v.object({
  platform: viewerPlatformValidator,
  returnOrigin: v.string(),
  returnPath: v.string(),
  nonceHash: v.string(),
});

export type ConsumedLogin = Pick<Doc<"viewerLoginStates">, "platform" | "returnOrigin" | "returnPath" | "nonceHash">;

/**
 * Deletes the login behind `stateHash` and returns it while it is still
 * usable. Deleted on every attempt, so a replayed callback finds nothing.
 */
export async function consumeViewerLoginState(
  ctx: MutationCtx,
  stateHash: string,
  now: number
): Promise<ConsumedLogin | null> {
  const row = await ctx.db
    .query("viewerLoginStates")
    .withIndex("by_state_hash", (q) => q.eq("stateHash", stateHash))
    .unique();
  if (row) {
    await ctx.db.delete(row._id);
  }
  if (row === null || !viewerLoginStateUsable(row, now)) {
    return null;
  }
  return {
    platform: row.platform,
    returnOrigin: row.returnOrigin,
    returnPath: row.returnPath,
    nonceHash: row.nonceHash,
  };
}

export const consumeLoginState = internalMutation({
  args: { stateHash: v.string() },
  returns: v.union(v.null(), consumedLoginValidator),
  handler: (ctx, { stateHash }) => consumeViewerLoginState(ctx, stateHash, Date.now()),
});

/**
 * Records a finished sign-in: the viewer's profile and sealed grant, and a
 * handoff the page can exchange once for a session. The grant replaces the
 * previous one in place, clearing any refusal, since the viewer just consented
 * again.
 */
export const completeLogin = internalMutation({
  args: {
    platform: viewerPlatformValidator,
    profile: v.object({
      platformUserId: v.string(),
      login: v.string(),
      displayName: v.string(),
      avatarUrl: v.optional(v.string()),
    }),
    grant: v.object({
      sealedAccessToken: v.string(),
      sealedRefreshToken: v.string(),
      expiresAt: v.number(),
      scopes: v.array(v.string()),
    }),
    origin: v.string(),
    nonceHash: v.string(),
    codeHash: v.string(),
  },
  returns: v.id("viewers"),
  handler: async (ctx, args): Promise<Id<"viewers">> => {
    assertSha256Hex(args.codeHash, "codeHash");
    assertSha256Hex(args.nonceHash, "nonceHash");
    const now = Date.now();

    const existing = await ctx.db
      .query("viewers")
      .withIndex("by_platform_and_platform_user_id", (q) =>
        q.eq("platform", args.platform).eq("platformUserId", args.profile.platformUserId)
      )
      .unique();
    const profile = { ...args.profile, updatedAt: now };
    let viewerId: Id<"viewers">;
    if (existing) {
      viewerId = existing._id;
      await ctx.db.patch(viewerId, profile);
    } else {
      viewerId = await ctx.db.insert("viewers", { platform: args.platform, ...profile });
    }

    const tokens = await ctx.db
      .query("viewerPlatformTokens")
      .withIndex("by_viewer", (q) => q.eq("viewerId", viewerId))
      .unique();
    if (tokens) {
      await ctx.db.patch(tokens._id, { ...args.grant, authFailedAt: undefined });
    } else {
      await ctx.db.insert("viewerPlatformTokens", { viewerId, ...args.grant });
    }

    const handoffId = await ctx.db.insert("viewerHandoffs", {
      codeHash: args.codeHash,
      viewerId,
      origin: args.origin,
      nonceHash: args.nonceHash,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(VIEWER_HANDOFF_TTL_MS, internal.viewerLogin.expireHandoff, { id: handoffId });
    return viewerId;
  },
});

export const expireHandoff = internalMutation({
  args: { id: v.id("viewerHandoffs") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) {
      await ctx.db.delete(id);
    }
    return null;
  },
});
