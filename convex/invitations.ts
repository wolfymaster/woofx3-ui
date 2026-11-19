import { getAuthUserId } from "@convex-dev/auth/server";
import { canReadChannelRole, normalizeTwitchLogin, type TwitchUser } from "@shared/twitch-users";
import { ConvexError, type Infer, v } from "convex/values";
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
import { spendActionLimit } from "./lib/actionRateLimits";
import { roleSatisfies } from "./lib/instanceRoles";
import { invitationEngine } from "./lib/invitationEngine";
import { acceptRefusal, invitationTarget } from "./lib/invitationTarget";
import { getInstanceMembership, maskedEmail, normalizeEmail } from "./lib/teamAccess";
import {
  fetchHasChannelRole,
  fetchTwitchAppCredentials,
  fetchTwitchUser,
  type HelixCredentials,
} from "./lib/twitchUsers";
import { suspensionOf } from "./org/billing";
import { isEmailVerified } from "./org/identity";
import {
  applyOrgRoleToEngines,
  getAccountMembership,
  grantEngineRole,
  orgSeatsFull,
  SEATS_FULL,
} from "./org/membership";
import {
  can,
  orgCan,
  orgRoleOf,
  requireAction,
  requireActionFor,
  requireActionInAction,
  viewerRoles,
} from "./org/policy";

const INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

const ROLE_VALIDATOR = v.union(v.literal("admin"), v.literal("member"));

function randomToken(): string {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

type PendingInvitation = Pick<
  Doc<"invitations">,
  | "_id"
  | "email"
  | "platform"
  | "platformLogin"
  | "platformDisplayName"
  | "platformProfileImageUrl"
  | "role"
  | "instanceId"
  | "engineRole"
  | "createdAt"
  | "expiresAt"
>;

function toPendingInvitation(r: Doc<"invitations">, showEmail: boolean): PendingInvitation {
  return {
    _id: r._id,
    email: r.email === undefined || showEmail ? r.email : maskedEmail(r.email),
    platform: r.platform,
    platformLogin: r.platformLogin,
    platformDisplayName: r.platformDisplayName,
    platformProfileImageUrl: r.platformProfileImageUrl,
    role: r.role,
    instanceId: r.instanceId,
    engineRole: r.engineRole,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/**
 * Pending invitations the caller may manage on this engine's team page, or
 * null when they may manage none: an engine's admins see its invitations, as
 * `revoke` allows. Invitee emails are personal data, so like members' they
 * are shown whole only to a viewer with `viewMemberEmails` and masked for
 * everyone else. `now` (ms) decides which have expired; a query can't read
 * the clock without losing its cache.
 */
export const listForEngine = query({
  args: { instanceId: v.id("instances"), now: v.number() },
  handler: async (ctx, { instanceId, now }): Promise<{ invitations: PendingInvitation[] } | null> => {
    const viewer = await viewerRoles(ctx, { engine: instanceId });
    if (viewer === null || !can(viewer.roles, "manageEngineMembers")) {
      return null;
    }
    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId).eq("status", "pending"))
      .collect();
    const showEmails = can(viewer.roles, "viewMemberEmails");
    const invitations = rows.filter((r) => r.expiresAt > now).map((r) => toPendingInvitation(r, showEmails));
    return { invitations };
  },
});

export interface OrganizationInvitation extends PendingInvitation {
  engineName: string;
}

/** Every pending invitation to the organization's engines, for a role that manages its members; null otherwise. */
export const listForOrganization = query({
  args: { accountId: v.id("accounts"), now: v.number() },
  handler: async (ctx, { accountId, now }): Promise<OrganizationInvitation[] | null> => {
    const viewer = await viewerRoles(ctx, { org: accountId });
    if (viewer === null || !can(viewer.roles, "manageMembers")) {
      return null;
    }
    const showEmails = can(viewer.roles, "viewMemberEmails");
    const instances = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const invitations: OrganizationInvitation[] = [];
    for (const instance of instances) {
      const rows = await ctx.db
        .query("invitations")
        .withIndex("by_instance", (q) => q.eq("instanceId", instance._id).eq("status", "pending"))
        .collect();
      for (const row of rows) {
        if (row.expiresAt > now) {
          invitations.push({ ...toPendingInvitation(row, showEmails), engineName: instance.name });
        }
      }
    }
    return invitations;
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
 * The engine's Twitch link (if any) for a lookup to borrow. Tokens stay out of
 * the result: the action fetches them through `ensureFreshTwitchToken`.
 */
export const engineTwitchLink = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<TwitchLinkSummary | null> => {
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();
    return link ? { instanceId, scopes: link.scopes ?? [] } : null;
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

/** A live invitation to this engine. */
function isPendingFor(invitation: Doc<"invitations">, instanceId: Id<"instances">, now: number): boolean {
  return invitation.status === "pending" && invitation.expiresAt > now && invitation.instanceId === instanceId;
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
  const { userId } = await requireActionInAction(ctx, { engine: instanceId }, "manageEngineMembers");
  return { userId, twitchLink: await ctx.runQuery(internal.invitations.engineTwitchLink, { instanceId }) };
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
    await spendActionLimit(ctx, "inviteLookup", args.instanceId);

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

/**
 * Whether the person an invitation names already has a seat in the engine's org.
 * An email can belong to several users when addresses are unverified, and only
 * a verified one proves the address is theirs, so with more than one the
 * unverified users do not count.
 */
async function inviteeInOrg(
  ctx: QueryCtx,
  instance: Doc<"instances">,
  target: Infer<typeof TARGET_VALIDATOR>
): Promise<boolean> {
  if (target.kind === "email") {
    const sharing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalizeEmail(target.email)))
      .collect();
    const owners = sharing.length > 1 ? sharing.filter(isEmailVerified) : sharing;
    for (const user of owners) {
      if ((await getAccountMembership(ctx, instance.accountId, user._id)) !== null) {
        return true;
      }
    }
    return false;
  }
  const twitchAccount = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) => q.eq("provider", "twitch").eq("providerAccountId", target.twitchUserId))
    .first();
  return twitchAccount !== null && (await getAccountMembership(ctx, instance.accountId, twitchAccount.userId)) !== null;
}

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

/** The one refusal a caller without `viewMemberEmails` gets for a full org or an address already on the engine. */
const INVITE_REFUSED =
  "This invitation couldn't be sent. Your organization may have no free seats, or this person may already be on this engine";

const NOT_IN_ORGANIZATION =
  "You can invite people who are already in your organization. Ask its owner or an admin to invite someone new";

/**
 * Writes the invitation after re-checking, inside the transaction, that the
 * inviter may still manage the engine's members and the invitee is neither on it
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
    const inviter = await requireActionFor(ctx, args.inviterUserId, { engine: args.instanceId }, "manageEngineMembers");
    const instance = await ctx.db.get(args.instanceId);
    if (instance === null) {
      throw new Error(`insertInvitation: engine ${args.instanceId} vanished inside the transaction`);
    }
    // Only a caller who may see member emails learns which refusal an address
    // hit; for anyone else "full" and "already on it" must read the same, or
    // inviting a guessed address would reveal whether it belongs to a member.
    const hidesMembers = args.target.kind === "email" && !can(inviter.roles, "viewMemberEmails");

    // Someone who may not spend a seat may only invite people already in the
    // org. `accept` enforces that for every invitation; refusing here as well
    // would tell an email's owner apart as a member, so only a Twitch target,
    // whose identity is public, is refused up front.
    const inOrg = await inviteeInOrg(ctx, instance, args.target);
    if (args.target.kind === "twitch" && !inOrg && !can(inviter.roles, "spendSeat")) {
      throw new ConvexError({ code: "not_in_organization", message: NOT_IN_ORGANIZATION });
    }
    const now = Date.now();
    if (await orgSeatsFull(ctx, instance.accountId)) {
      if (hidesMembers) {
        throw new ConvexError({ code: "invite_refused", message: INVITE_REFUSED });
      }
      if (!inOrg) {
        throw new ConvexError({ code: "seats_full", message: SEATS_FULL });
      }
    }
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
        throw new ConvexError({ code: "invalid_email", message: "That isn't an email address" });
      }

      const engineMembers = await ctx.db
        .query("instanceMembers")
        .withIndex("by_instance", (q) => q.eq("instanceId", instance._id))
        .collect();
      for (const row of engineMembers) {
        const user = await ctx.db.get(row.userId);
        if (user?.email !== undefined && normalizeEmail(user.email) === normalized) {
          throw hidesMembers
            ? new ConvexError({ code: "invite_refused", message: INVITE_REFUSED })
            : new ConvexError({ code: "already_on_engine", message: "That user is already on this engine" });
        }
      }

      const existing = await ctx.db
        .query("invitations")
        .withIndex("by_account_email", (q) => q.eq("accountId", instance.accountId).eq("email", normalized))
        .collect();
      if (existing.some((r) => isPendingFor(r, instance._id, now))) {
        throw new ConvexError({
          code: "already_invited",
          message: "An invitation to this engine is already pending for this email",
        });
      }

      await ctx.db.insert("invitations", { ...common, email: normalized });
      return { token, expiresAt };
    }

    const refusal = await twitchInviteRefusal(ctx, instance, args.inviterUserId, args.target.twitchUserId);
    if (refusal) {
      throw new ConvexError({ code: "not_invitable", message: refusal });
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
    await spendActionLimit(ctx, "inviteCreate", args.instanceId);

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
      throw new ConvexError({ code: "no_twitch_user", message: "No Twitch user by that name" });
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
    if (!inv) {
      throw new Error("Invitation not found");
    }

    await requireAction(ctx, { engine: inv.instanceId }, "manageEngineMembers");

    if (inv.status !== "pending") {
      throw new Error("Invitation is no longer pending");
    }

    await ctx.db.patch(inv._id, { status: "revoked" });
  },
});

/**
 * How an `accept` call ended. The expected ways an invite link fails are
 * values, not throws: production Convex hides a thrown message from the
 * client, so a throw would reach the user as "Server Error".
 */
/** What `accept` throws for an email invitation when the caller's address is not verified. */
export type EmailUnverifiedRefusal = { code: "email_unverified"; message: string };

export type AcceptOutcome =
  | { status: "accepted"; accountId: Id<"accounts">; instanceId: Id<"instances">; alreadyMember: boolean }
  | { status: "already_member"; instanceId: Id<"instances"> }
  | { status: "already_accepted" }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "not_found" }
  | { status: "wrong_account"; message: string }
  | { status: "engine_gone" }
  | { status: "seats_full" }
  | { status: "not_in_organization" }
  | { status: "org_suspended" };

export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<AcceptOutcome> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    const now = Date.now();

    if (!inv) {
      return { status: "not_found" };
    }
    if (inv.status === "revoked") {
      return { status: "revoked" };
    }
    if (inv.status === "expired" || (inv.status === "pending" && inv.expiresAt <= now)) {
      return { status: "expired" };
    }
    if (inv.status === "accepted") {
      // Opening a used link again is harmless for someone who already has the engine.
      const engine = await invitationEngine(ctx, inv);
      if (engine !== null && (await getInstanceMembership(ctx, engine.instanceId, userId)) !== null) {
        return { status: "already_member", instanceId: engine.instanceId };
      }
      return { status: "already_accepted" };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

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
      return { status: "wrong_account", message: refusal };
    }
    // The address is what proves the caller is the invitee, so it must be
    // verified; a Twitch invite is proven by the Twitch account instead.
    if (inv.email !== undefined && !isEmailVerified(user)) {
      throw new ConvexError<EmailUnverifiedRefusal>({
        code: "email_unverified",
        message: "Verify your email address to accept this invitation.",
      });
    }

    const account = await ctx.db.get(inv.accountId);
    if (account === null) {
      throw new Error(`accept: invitation ${inv._id} names a missing account`);
    }
    const engine = await invitationEngine(ctx, inv);
    if (engine === null) {
      return { status: "engine_gone" };
    }
    const instance = await ctx.db.get(engine.instanceId);
    if (instance !== null && (await suspensionOf(ctx, instance)) !== null) {
      return { status: "org_suspended" };
    }

    const existingMember =
      account.ownerId === userId || (await getAccountMembership(ctx, inv.accountId, userId)) !== null;
    // The seat is taken now, so the inviter must still be allowed to spend one:
    // an invitation from an engine admin only reaches people already in the org.
    if (!existingMember && !orgCan(await orgRoleOf(ctx, account, inv.invitedByUserId), "spendSeat")) {
      return { status: "not_in_organization" };
    }
    if (!existingMember && (await orgSeatsFull(ctx, inv.accountId))) {
      return { status: "seats_full" };
    }
    if (account.ownerId !== userId) {
      // An invitation only adds access: someone made an engine admin after it
      // was sent keeps admin when they accept a member invite.
      const held = await getInstanceMembership(ctx, engine.instanceId, userId);
      const engineRole = roleSatisfies(held?.role, "admin") ? "admin" : engine.engineRole;
      await grantEngineRole(ctx, engine.instanceId, userId, engineRole);
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
    return {
      status: "accepted",
      accountId: inv.accountId,
      instanceId: engine.instanceId,
      alreadyMember: existingMember,
    };
  },
});
