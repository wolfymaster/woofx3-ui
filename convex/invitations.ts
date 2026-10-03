import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { acceptRefusal, invitationTarget } from "./lib/invitationTarget";
import {
  assertCanManageAccountTeam,
  canAccessAccount,
  grantInstanceAccessForAccount,
  normalizeEmail,
} from "./lib/teamAccess";
import {
  canReadChannelRole,
  fetchHasChannelRole,
  fetchTwitchAppCredentials,
  fetchTwitchUser,
  type HelixCredentials,
  normalizeTwitchLogin,
  type TwitchUser,
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
    const target = invitationTarget(inv);
    return {
      accountName: account?.name ?? null,
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
 * Whether the user may manage the account's team and, when they may, the
 * account's Twitch link (if any) for a lookup to borrow. Tokens stay out of
 * the result: the action fetches them through `ensureFreshTwitchToken`.
 */
export const teamManagerContext = internalQuery({
  args: { accountId: v.id("accounts"), userId: v.id("users") },
  handler: async (ctx, args): Promise<{ twitchLink: TwitchLinkSummary | null } | null> => {
    const gate = await assertCanManageAccountTeam(ctx, args.accountId, args.userId);
    if (!gate) {
      return null;
    }
    const instances = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .take(10);
    for (const instance of instances) {
      const link = await ctx.db
        .query("platformLinks")
        .withIndex("by_instance", (q) => q.eq("instanceId", instance._id))
        .filter((q) => q.eq(q.field("platform"), "twitch"))
        .first();
      if (link) {
        return { twitchLink: { instanceId: instance._id, scopes: link.scopes ?? [] } };
      }
    }
    return { twitchLink: null };
  },
});

async function twitchInviteRefusal(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  inviterUserId: Id<"users">,
  twitchUserId: string
): Promise<string | null> {
  const authAccount = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) => q.eq("provider", "twitch").eq("providerAccountId", twitchUserId))
    .first();
  if (authAccount) {
    if (authAccount.userId === inviterUserId) {
      return "You're already on this team";
    }
    const account = await ctx.db.get(accountId);
    const isOwner = account?.ownerId === authAccount.userId;
    const membership = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) => q.eq("accountId", accountId).eq("userId", authAccount.userId))
      .first();
    if (isOwner || membership) {
      return "That Twitch user is already on this team";
    }
  }

  const invites = await ctx.db
    .query("invitations")
    .withIndex("by_account_platform_user", (q) =>
      q.eq("accountId", accountId).eq("platform", "twitch").eq("platformUserId", twitchUserId)
    )
    .take(50);
  const now = Date.now();
  if (invites.some((r) => r.status === "pending" && r.expiresAt > now)) {
    return "An invitation is already pending for that Twitch account";
  }
  return null;
}

/** Why the Twitch user cannot be invited to the account, or null when they can. */
export const twitchInviteRefusalFor = internalQuery({
  args: { accountId: v.id("accounts"), inviterUserId: v.id("users"), twitchUserId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    return twitchInviteRefusal(ctx, args.accountId, args.inviterUserId, args.twitchUserId);
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

async function requireTeamManager(
  ctx: ActionCtx,
  accountId: Id<"accounts">
): Promise<{ userId: Id<"users">; twitchLink: TwitchLinkSummary | null }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const context = await ctx.runQuery(internal.invitations.teamManagerContext, { accountId, userId });
  if (!context) {
    throw new Error("Not authorized");
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
 * invitation exists. Limited to people who manage the account's team so it
 * cannot serve as an open Twitch lookup.
 */
export const lookupTwitchUser = action({
  args: { accountId: v.id("accounts"), login: v.string() },
  handler: async (ctx, args): Promise<TwitchInviteCandidate | null> => {
    const { userId, twitchLink } = await requireTeamManager(ctx, args.accountId);

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
      accountId: args.accountId,
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

/**
 * Writes the invitation after re-checking, inside the transaction, that the
 * inviter still manages the team and the invitee is neither on it nor already
 * invited. A Twitch target's profile comes from the server's own Helix lookup
 * in `create`, never from the client.
 */
export const insertInvitation = internalMutation({
  args: {
    accountId: v.id("accounts"),
    inviterUserId: v.id("users"),
    role: ROLE_VALIDATOR,
    target: v.union(
      v.object({ kind: v.literal("email"), email: v.string() }),
      v.object({
        kind: v.literal("twitch"),
        twitchUserId: v.string(),
        login: v.string(),
        displayName: v.string(),
        profileImageUrl: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ token: string; expiresAt: number }> => {
    const gate = await assertCanManageAccountTeam(ctx, args.accountId, args.inviterUserId);
    if (!gate) {
      throw new Error("Not authorized");
    }

    const now = Date.now();
    const token = randomToken();
    const expiresAt = now + INVITATION_LIFETIME_MS;
    const common = {
      accountId: args.accountId,
      role: args.role,
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

      const memberRows = await ctx.db
        .query("accountMembers")
        .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
        .collect();
      for (const row of memberRows) {
        const user = await ctx.db.get(row.userId);
        if (!user) continue;
        const u = user as Record<string, unknown>;
        const em = typeof u.email === "string" ? normalizeEmail(u.email) : "";
        if (em === normalized) {
          throw new Error("That user is already a member of this account");
        }
      }

      const existing = await ctx.db
        .query("invitations")
        .withIndex("by_account_email", (q) => q.eq("accountId", args.accountId).eq("email", normalized))
        .collect();
      if (existing.some((r) => r.status === "pending" && r.expiresAt > now)) {
        throw new Error("An invitation is already pending for this email");
      }

      await ctx.db.insert("invitations", { ...common, email: normalized });
      return { token, expiresAt };
    }

    const refusal = await twitchInviteRefusal(ctx, args.accountId, args.inviterUserId, args.target.twitchUserId);
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
 * An invitation for one person, by email or by Twitch account. A Twitch target
 * is given by id only; the login, name and avatar stored with it come from a
 * fresh Helix lookup here, so a client cannot label an invite as someone else.
 */
export const create = action({
  args: {
    accountId: v.id("accounts"),
    role: ROLE_VALIDATOR,
    target: v.union(
      v.object({ kind: v.literal("email"), email: v.string() }),
      v.object({ kind: v.literal("twitch"), twitchUserId: v.string() })
    ),
  },
  handler: async (ctx, args): Promise<{ token: string; expiresAt: number }> => {
    const { userId, twitchLink } = await requireTeamManager(ctx, args.accountId);

    if (args.target.kind === "email") {
      return ctx.runMutation(internal.invitations.insertInvitation, {
        accountId: args.accountId,
        inviterUserId: userId,
        role: args.role,
        target: args.target,
      });
    }

    const { credentials } = await lookupCredentials(ctx, twitchLink);
    const user = await fetchTwitchUser(credentials, { id: args.target.twitchUserId });
    if (!user) {
      throw new Error("No Twitch user by that name");
    }
    return ctx.runMutation(internal.invitations.insertInvitation, {
      accountId: args.accountId,
      inviterUserId: userId,
      role: args.role,
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const inv = await ctx.db.get(args.invitationId);
    if (!inv) throw new Error("Invitation not found");

    const gate = await assertCanManageAccountTeam(ctx, inv.accountId, userId);
    if (!gate) throw new Error("Not authorized");

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
      await ctx.db.patch(inv._id, { status: "expired" });
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

    const existingMember = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) => q.eq("accountId", inv.accountId).eq("userId", userId))
      .first();

    // The account's engine, so the invitee lands on it. An account has one
    // instance; a registered one is preferred in case an unfinished one lingers.
    const accountInstances = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", inv.accountId))
      .take(10);
    const instanceId = (accountInstances.find((instance) => instance.clientId) ?? accountInstances[0])?._id ?? null;

    if (existingMember) {
      await ctx.db.patch(inv._id, { status: "accepted" });
      return { accountId: inv.accountId, instanceId, alreadyMember: true as const };
    }

    await ctx.db.insert("accountMembers", {
      accountId: inv.accountId,
      userId,
      role: inv.role,
      createdAt: now,
    });

    await grantInstanceAccessForAccount(ctx, inv.accountId, userId, inv.role);

    await ctx.db.patch(inv._id, { status: "accepted" });

    return { accountId: inv.accountId, instanceId, alreadyMember: false as const };
  },
});
