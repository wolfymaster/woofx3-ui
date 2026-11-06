import { getAuthUserId } from "@convex-dev/auth/server";
import { canReadChannelRole, normalizeTwitchLogin, type TwitchUser } from "@shared/twitch-users";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";
import { roleSatisfies } from "./lib/instanceRoles";
import { invitationEngine } from "./lib/invitationEngine";
import { acceptRefusal, invitationTarget } from "./lib/invitationTarget";
import { requireOrgAction } from "./lib/orgRoles";
import {
  applyOrgRoleToEngines,
  canAccessAccount,
  getAccountMembership,
  getInstanceMembership,
  grantEngineRole,
  normalizeEmail,
} from "./lib/teamAccess";
import {
  fetchHasChannelRole,
  fetchTwitchAppCredentials,
  fetchTwitchUser,
  type HelixCredentials,
} from "./lib/twitchUsers";

const INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

const ROLE_VALIDATOR = v.union(v.literal("admin"), v.literal("member"));

function randomToken(): string {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

export const listForAccount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const allowed = await canAccessAccount(ctx, args.accountId, userId);
    if (!allowed) return null;

    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();

    const now = Date.now();
    const invitations = rows
      .filter((r) => r.status === "pending" && r.expiresAt > now)
      .map((r) => ({
        _id: r._id,
        email: r.email,
        platform: r.platform,
        platformLogin: r.platformLogin,
        platformDisplayName: r.platformDisplayName,
        platformProfileImageUrl: r.platformProfileImageUrl,
        role: r.role,
        instanceId: r.instanceId ?? null,
        engineRole: r.engineRole ?? null,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));

    return { invitations };
  },
});

/**
 * Who an invite link is for, so the accept page can say which Twitch account
 * to sign in with before anyone is signed in. Holding the token is what grants
 * this; an email target is not echoed back, since the page has no use for it.
 */
export const previewByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!inv || inv.status !== "pending" || inv.expiresAt <= Date.now()) {
      return null;
    }
    const account = await ctx.db.get(inv.accountId);
    const engine = await invitationEngine(ctx, inv);
    const instance = engine ? await ctx.db.get(engine.instanceId) : null;
    const target = invitationTarget(inv);
    return {
      accountName: account?.name ?? null,
      engineName: instance?.name ?? null,
      target:
        target.kind === "email"
          ? { kind: "email" as const }
          : {
              kind: "twitch" as const,
              login: inv.platformLogin ?? null,
              displayName: inv.platformDisplayName ?? null,
              profileImageUrl: inv.platformProfileImageUrl ?? null,
            },
    };
  },
});

// ---------------------------------------------------------------------------
// Twitch lookup
// ---------------------------------------------------------------------------

interface TwitchLinkSummary {
  instanceId: Id<"instances">;
  scopes: string[];
}

/**
 * The engine's org and Twitch link (if any) for a lookup to borrow, when the
 * user is an admin of the engine, or null when they aren't. Tokens stay out
 * of the result: the action fetches them through `ensureFreshTwitchToken`.
 */
export const engineInviterContext = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, args): Promise<{ accountId: Id<"accounts">; twitchLink: TwitchLinkSummary | null } | null> => {
    const membership = await getInstanceMembership(ctx, args.instanceId, args.userId);
    const instance = await ctx.db.get(args.instanceId);
    if (instance === null || !roleSatisfies(membership?.role, "admin")) {
      return null;
    }
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instance._id))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();
    return {
      accountId: instance.accountId,
      twitchLink: link ? { instanceId: instance._id, scopes: link.scopes ?? [] } : null,
    };
  },
});

async function twitchInviteRefusal(
  ctx: QueryCtx,
  instance: Doc<"instances">,
  inviterUserId: Id<"users">,
  twitchUserId: string
): Promise<string | null> {
  const authAccount = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) => q.eq("provider", "twitch").eq("providerAccountId", twitchUserId))
    .first();
  if (authAccount) {
    if (authAccount.userId === inviterUserId) {
      return "You're already on this engine";
    }
    if ((await getInstanceMembership(ctx, instance._id, authAccount.userId)) !== null) {
      return "That Twitch user is already on this engine";
    }
  }

  const invites = await ctx.db
    .query("invitations")
    .withIndex("by_account_platform_user", (q) =>
      q.eq("accountId", instance.accountId).eq("platform", "twitch").eq("platformUserId", twitchUserId)
    )
    .take(50);
  if (invites.some((r) => isPendingFor(r, instance._id, Date.now()))) {
    return "An invitation to this engine is already pending for that Twitch account";
  }
  return null;
}

/** A live invitation to this engine. An org-wide one from before engine invites counts for every engine. */
function isPendingFor(invitation: Doc<"invitations">, instanceId: Id<"instances">, now: number): boolean {
  return (
    invitation.status === "pending" &&
    invitation.expiresAt > now &&
    (invitation.instanceId === undefined || invitation.instanceId === instanceId)
  );
}

/** Why the Twitch user cannot be invited to the engine, or null when they can. */
export const twitchInviteRefusalFor = internalQuery({
  args: { instanceId: v.id("instances"), inviterUserId: v.id("users"), twitchUserId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const instance = await ctx.db.get(args.instanceId);
    if (instance === null) {
      throw new Error("Engine not found");
    }
    return twitchInviteRefusal(ctx, instance, args.inviterUserId, args.twitchUserId);
  },
});

interface LookupCredentials {
  credentials: HelixCredentials;
  /** Set when the credentials are the channel's own, which reading its moderators and VIPs needs. */
  broadcasterUserId: string | null;
}

/**
 * `/helix/users` needs no particular scope, so the account's own Twitch link
 * is used when there is one and an app token otherwise: inviting works before
 * the channel is linked.
 */
async function lookupCredentials(ctx: ActionCtx, twitchLink: TwitchLinkSummary | null): Promise<LookupCredentials> {
  const clientId = process.env.AUTH_TWITCH_ID;
  if (twitchLink && clientId) {
    // A link whose refresh fails still leaves the app token, which is enough
    // for the lookup itself; only the moderator and VIP badges are lost.
    const token = await ctx
      .runAction(internal.platformRealtime.ensureFreshTwitchToken, { instanceId: twitchLink.instanceId })
      .catch(() => null);
    if (token) {
      return {
        credentials: { accessToken: token.accessToken, clientId },
        broadcasterUserId: token.broadcasterUserId,
      };
    }
  }
  return { credentials: await fetchTwitchAppCredentials(), broadcasterUserId: null };
}

async function requireEngineInviter(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<{ userId: Id<"users">; twitchLink: TwitchLinkSummary | null }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const context = await ctx.runQuery(internal.invitations.engineInviterContext, { instanceId, userId });
  if (!context) {
    throw new Error("Not authorized for this instance");
  }
  return { userId, twitchLink: context.twitchLink };
}

export interface TwitchInviteCandidate extends TwitchUser {
  /** Set only when the linked token may read the channel's moderators. */
  isModerator?: boolean;
  /** Set only when the linked token may read the channel's VIPs. */
  isVip?: boolean;
  /** Why this person cannot be invited, shown in place of the confirm button. */
  refusal: string | null;
}

/**
 * The person a Twitch login names, for the inviter to confirm before an
 * invitation exists. Limited to the engine's admins so it cannot serve as an
 * open Twitch lookup.
 */
export const lookupTwitchUser = action({
  args: { instanceId: v.id("instances"), login: v.string() },
  handler: async (ctx, args): Promise<TwitchInviteCandidate | null> => {
    const { userId, twitchLink } = await requireEngineInviter(ctx, args.instanceId);

    const login = normalizeTwitchLogin(args.login);
    if (!login) {
      return null;
    }

    const { credentials, broadcasterUserId } = await lookupCredentials(ctx, twitchLink);
    const user = await fetchTwitchUser(credentials, { login });
    if (!user) {
      return null;
    }

    const refusal: string | null = await ctx.runQuery(internal.invitations.twitchInviteRefusalFor, {
      instanceId: args.instanceId,
      inviterUserId: userId,
      twitchUserId: user.twitchUserId,
    });

    const candidate: TwitchInviteCandidate = { ...user, refusal };
    if (twitchLink && broadcasterUserId) {
      const [isModerator, isVip] = await Promise.all([
        canReadChannelRole("moderator", twitchLink.scopes)
          ? fetchHasChannelRole(credentials, "moderator", broadcasterUserId, user.twitchUserId)
          : undefined,
        canReadChannelRole("vip", twitchLink.scopes)
          ? fetchHasChannelRole(credentials, "vip", broadcasterUserId, user.twitchUserId)
          : undefined,
      ]);
      candidate.isModerator = isModerator;
      candidate.isVip = isVip;
    }
    return candidate;
  },
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const TARGET_VALIDATOR = v.union(
  v.object({ kind: v.literal("email"), email: v.string() }),
  v.object({
    kind: v.literal("twitch"),
    twitchUserId: v.string(),
    login: v.string(),
    displayName: v.string(),
    profileImageUrl: v.optional(v.string()),
  })
);

/**
 * Writes the invitation after re-checking, inside the transaction, that the
 * inviter is still an admin of the engine and the invitee is neither on it
 * nor already invited to it. A Twitch target's profile comes from the
 * server's own Helix lookup in `create`, never from the client.
 */
export const insertInvitation = internalMutation({
  args: {
    instanceId: v.id("instances"),
    inviterUserId: v.id("users"),
    engineRole: ROLE_VALIDATOR,
    target: TARGET_VALIDATOR,
  },
  handler: async (ctx, args): Promise<{ token: string; expiresAt: number }> => {
    const instance = await ctx.db.get(args.instanceId);
    const inviter = await getInstanceMembership(ctx, args.instanceId, args.inviterUserId);
    if (instance === null || !roleSatisfies(inviter?.role, "admin")) {
      throw new Error("Not authorized for this instance");
    }

    const now = Date.now();
    const token = randomToken();
    const expiresAt = now + INVITATION_LIFETIME_MS;
    const common = {
      accountId: instance.accountId,
      instanceId: instance._id,
      engineRole: args.engineRole,
      // Access is the engine grant; the invitee joins the org as a member.
      role: "member" as const,
      token,
      invitedByUserId: args.inviterUserId,
      status: "pending" as const,
      expiresAt,
      createdAt: now,
    };

    if (args.target.kind === "email") {
      const normalized = normalizeEmail(args.target.email);
      if (!normalized.includes("@")) {
        throw new Error("Invalid email");
      }

      const engineMembers = await ctx.db
        .query("instanceMembers")
        .withIndex("by_instance", (q) => q.eq("instanceId", instance._id))
        .collect();
      for (const row of engineMembers) {
        const user = await ctx.db.get(row.userId);
        if (user?.email !== undefined && normalizeEmail(user.email) === normalized) {
          throw new Error("That user is already on this engine");
        }
      }

      const existing = await ctx.db
        .query("invitations")
        .withIndex("by_account_email", (q) => q.eq("accountId", instance.accountId).eq("email", normalized))
        .collect();
      if (existing.some((r) => isPendingFor(r, instance._id, now))) {
        throw new Error("An invitation to this engine is already pending for this email");
      }

      await ctx.db.insert("invitations", { ...common, email: normalized });
      return { token, expiresAt };
    }

    const refusal = await twitchInviteRefusal(ctx, instance, args.inviterUserId, args.target.twitchUserId);
    if (refusal) {
      throw new Error(refusal);
    }

    await ctx.db.insert("invitations", {
      ...common,
      platform: "twitch",
      platformUserId: args.target.twitchUserId,
      platformLogin: args.target.login,
      platformDisplayName: args.target.displayName,
      platformProfileImageUrl: args.target.profileImageUrl,
    });
    return { token, expiresAt };
  },
});

/**
 * An invitation to one engine for one person, by email or by Twitch account.
 * A Twitch target is given by id only; the login, name and avatar stored with
 * it come from a fresh Helix lookup here, so a client cannot label an invite
 * as someone else.
 */
export const create = action({
  args: {
    instanceId: v.id("instances"),
    engineRole: ROLE_VALIDATOR,
    target: v.union(
      v.object({ kind: v.literal("email"), email: v.string() }),
      v.object({ kind: v.literal("twitch"), twitchUserId: v.string() })
    ),
  },
  handler: async (ctx, args): Promise<{ token: string; expiresAt: number }> => {
    const { userId, twitchLink } = await requireEngineInviter(ctx, args.instanceId);

    if (args.target.kind === "email") {
      return ctx.runMutation(internal.invitations.insertInvitation, {
        instanceId: args.instanceId,
        inviterUserId: userId,
        engineRole: args.engineRole,
        target: args.target,
      });
    }

    const { credentials } = await lookupCredentials(ctx, twitchLink);
    const user = await fetchTwitchUser(credentials, { id: args.target.twitchUserId });
    if (!user) {
      throw new Error("No Twitch user by that name");
    }
    return ctx.runMutation(internal.invitations.insertInvitation, {
      instanceId: args.instanceId,
      inviterUserId: userId,
      engineRole: args.engineRole,
      target: {
        kind: "twitch",
        twitchUserId: user.twitchUserId,
        login: user.login,
        displayName: user.displayName,
        profileImageUrl: user.profileImageUrl,
      },
    });
  },
});

// ---------------------------------------------------------------------------
// Revoke and accept
// ---------------------------------------------------------------------------

export const revoke = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const inv = await ctx.db.get(args.invitationId);
    if (!inv) throw new Error("Invitation not found");

    // An engine's admins manage its invitations; an org-wide one is the org's.
    if (inv.instanceId === undefined) {
      await requireOrgAction(ctx, inv.accountId, "manageMembers");
    } else {
      await requireInstanceRole(ctx, inv.instanceId, "admin");
    }

    if (inv.status !== "pending") {
      throw new Error("Invitation is no longer pending");
    }

    await ctx.db.patch(inv._id, { status: "revoked" });
  },
});

export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!inv || inv.status !== "pending") {
      throw new Error("Invalid or expired invitation");
    }

    const now = Date.now();
    if (inv.expiresAt <= now) {
      throw new Error("This invitation has expired");
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    const u = user as Record<string, unknown>;
    const twitchAccount = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "twitch"))
      .first();
    const refusal = acceptRefusal(invitationTarget(inv), {
      email: typeof u.email === "string" && u.email !== "" ? normalizeEmail(u.email) : null,
      twitchUserId: twitchAccount?.providerAccountId ?? null,
    });
    if (refusal) {
      throw new Error(refusal);
    }

    const account = await ctx.db.get(inv.accountId);
    if (account === null) {
      throw new Error("Invalid or expired invitation");
    }
    const engine = await invitationEngine(ctx, inv);
    if (engine === null) {
      throw new Error("The engine this invitation was for no longer exists");
    }

    const existingMember =
      account.ownerId === userId || (await getAccountMembership(ctx, inv.accountId, userId)) !== null;
    if (account.ownerId !== userId) {
      await grantEngineRole(ctx, engine.instanceId, userId, engine.engineRole);
    }
    // Only an org-wide invitation from before engine invites can say "admin".
    if (!existingMember && inv.role === "admin") {
      const row = await getAccountMembership(ctx, inv.accountId, userId);
      if (row === null) {
        throw new Error(`accept: ${userId} has no org membership after the engine grant`);
      }
      await ctx.db.patch(row._id, { role: "admin" });
      await applyOrgRoleToEngines(ctx, inv.accountId, userId, "admin");
    }

    await ctx.db.patch(inv._id, { status: "accepted" });
    return { accountId: inv.accountId, instanceId: engine.instanceId, alreadyMember: existingMember };
  },
});
