import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { HANDOFF_TTL_MS, type HandoffProvider, type HandoffRefusal, handoffRefusal } from "./lib/oauthHandoff";
import { safeRelativePath } from "./lib/safeRedirect";

/**
 * Holds an integration callback's result until the user who started the flow
 * claims it (`twitchIntegration.finishConnect`, `spotifyConnect.finish`).
 * The callback runs in whatever browser the provider redirected, so it never
 * writes the result itself: a connect minted by one user and completed in a
 * victim's browser must not land the victim's tokens on the first user's
 * instance. See lib/oauthHandoff.ts.
 */
export const store = internalMutation({
  args: {
    codeHash: v.string(),
    provider: v.union(v.literal("twitch"), v.literal("spotify")),
    userId: v.id("users"),
    instanceId: v.id("instances"),
    moduleId: v.optional(v.string()),
    redirectTo: v.string(),
    twitch: v.optional(
      v.object({
        platformUserId: v.string(),
        platformUsername: v.string(),
        profileImageUrl: v.optional(v.string()),
        accessToken: v.string(),
        refreshToken: v.string(),
        expiresAt: v.number(),
        scopes: v.array(v.string()),
      })
    ),
    spotify: v.optional(
      v.object({
        clientId: v.string(),
        authToken: v.string(),
        refreshToken: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    if ((args.provider === "twitch") !== (args.twitch !== undefined)) {
      throw new Error("A Twitch handoff carries exactly the Twitch result");
    }
    if ((args.provider === "spotify") !== (args.spotify !== undefined && args.moduleId !== undefined)) {
      throw new Error("A Spotify handoff carries the Spotify result and its module");
    }
    const id = await ctx.db.insert("oauthConnectHandoffs", {
      ...args,
      redirectTo: safeRelativePath(args.redirectTo),
      createdAt: Date.now(),
    });
    // Tokens must not outlive the handoff when nobody claims it.
    await ctx.scheduler.runAfter(HANDOFF_TTL_MS, internal.oauthConnectHandoff.expire, { id });
  },
});

export const expire = internalMutation({
  args: { id: v.id("oauthConnectHandoffs") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row) {
      await ctx.db.delete(id);
    }
  },
});

export type ClaimResult = { ok: true; row: Doc<"oauthConnectHandoffs"> } | { ok: false; error: HandoffRefusal };

/**
 * Deletes the handoff behind `codeHash` and returns it when `userId` may use
 * it. The row is deleted on every attempt, so a code is never tried twice.
 */
export async function claimHandoff(
  ctx: MutationCtx,
  codeHash: string,
  provider: HandoffProvider,
  userId: Id<"users">
): Promise<ClaimResult> {
  const row = await ctx.db
    .query("oauthConnectHandoffs")
    .withIndex("by_code_hash", (q) => q.eq("codeHash", codeHash))
    .first();
  if (row) {
    await ctx.db.delete(row._id);
  }
  const refusal = handoffRefusal(row, { provider, userId }, Date.now());
  if (refusal !== null || row === null) {
    return { ok: false, error: refusal ?? "connect_code_invalid" };
  }
  return { ok: true, row };
}
