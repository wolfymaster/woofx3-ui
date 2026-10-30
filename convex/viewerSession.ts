import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { generateOpaqueToken, hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";
import { VIEWER_SESSION_TTL_MS, type ViewerHandoffRefusal, viewerHandoffRefusal } from "./lib/viewerAuth";
import { viewerRateLimiter } from "./lib/viewerRateLimits";
import { viewerFromSession, viewerSessionByToken } from "./lib/viewerSessionAuth";

// A viewer's session on a user page. The page holds the session token (one
// per origin) and passes it to every page function; see lib/viewerAuth.ts for
// how a sign-in reaches this point.

export type ExchangeHandoffResult =
  | { ok: true; sessionToken: string; expiresAt: number }
  | { ok: false; error: ViewerHandoffRefusal | "rate_limited" };

const viewerProfileValidator = v.object({
  displayName: v.string(),
  avatarUrl: v.union(v.string(), v.null()),
});

/** The signed-in viewer's public profile, or null when the token signs nobody in. */
export const me = query({
  args: { sessionToken: v.string() },
  returns: v.union(v.null(), viewerProfileValidator),
  handler: async (ctx, { sessionToken }) => {
    const viewer = await viewerFromSession(ctx, sessionToken);
    if (!viewer) {
      return null;
    }
    return { displayName: viewer.displayName, avatarUrl: viewer.avatarUrl ?? null };
  },
});

/**
 * Turns the one-time code a sign-in returned to the page, plus the nonce the
 * page kept from when it started that sign-in, into a session token. An
 * action so the token comes from a fresh random source; only its hash is
 * stored.
 */
export const exchangeHandoff = action({
  args: { code: v.string(), nonce: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), sessionToken: v.string(), expiresAt: v.number() }),
    v.object({
      ok: v.literal(false),
      error: v.union(
        v.literal("handoff_invalid"),
        v.literal("handoff_expired"),
        v.literal("nonce_mismatch"),
        v.literal("rate_limited")
      ),
    })
  ),
  handler: async (ctx, { code, nonce }): Promise<ExchangeHandoffResult> => {
    const limit = await viewerRateLimiter.limit(ctx, "viewerHandoffExchange");
    if (!limit.ok) {
      return { ok: false, error: "rate_limited" };
    }
    if (!isOpaqueToken(code) || !isOpaqueToken(nonce)) {
      return { ok: false, error: "handoff_invalid" };
    }
    const sessionToken = generateOpaqueToken();
    const redeemed: RedeemHandoffResult = await ctx.runMutation(internal.viewerSession.redeemHandoff, {
      codeHash: await hashOpaqueToken(code),
      nonceHash: await hashOpaqueToken(nonce),
      sessionTokenHash: await hashOpaqueToken(sessionToken),
    });
    if (!redeemed.ok) {
      return redeemed;
    }
    return { ok: true, sessionToken, expiresAt: redeemed.expiresAt };
  },
});

export type RedeemHandoffResult = { ok: true; expiresAt: number } | { ok: false; error: ViewerHandoffRefusal };

/**
 * Deletes the handoff behind `codeHash` and, when it may be used, opens a
 * session for its viewer on the origin the sign-in returned to. Deleted on
 * every attempt, so a replayed code opens nothing.
 */
export async function redeemViewerHandoff(
  ctx: MutationCtx,
  args: { codeHash: string; nonceHash: string; sessionTokenHash: string },
  now: number
): Promise<RedeemHandoffResult> {
  const row = await ctx.db
    .query("viewerHandoffs")
    .withIndex("by_code_hash", (q) => q.eq("codeHash", args.codeHash))
    .unique();
  if (row) {
    await ctx.db.delete(row._id);
  }
  const refusal = viewerHandoffRefusal(row, args.nonceHash, now);
  if (refusal !== null || row === null) {
    return { ok: false, error: refusal ?? "handoff_invalid" };
  }
  const expiresAt = now + VIEWER_SESSION_TTL_MS;
  const sessionId = await ctx.db.insert("viewerSessions", {
    tokenHash: args.sessionTokenHash,
    viewerId: row.viewerId,
    origin: row.origin,
    expiresAt,
  });
  await ctx.scheduler.runAt(expiresAt, internal.viewerSession.expireSession, { id: sessionId });
  return { ok: true, expiresAt };
}

export const redeemHandoff = internalMutation({
  args: { codeHash: v.string(), nonceHash: v.string(), sessionTokenHash: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), expiresAt: v.number() }),
    v.object({
      ok: v.literal(false),
      error: v.union(v.literal("handoff_invalid"), v.literal("handoff_expired"), v.literal("nonce_mismatch")),
    })
  ),
  handler: (ctx, args) => redeemViewerHandoff(ctx, args, Date.now()),
});

export const expireSession = internalMutation({
  args: { id: v.id("viewerSessions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) {
      await ctx.db.delete(id);
    }
    return null;
  },
});

/** Ends the session a token names. Signing out a session that is already gone succeeds. */
export const signOut = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const session = await viewerSessionByToken(ctx, sessionToken);
    if (session) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});
