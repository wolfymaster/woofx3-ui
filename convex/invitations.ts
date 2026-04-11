import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  assertCanManageAccountTeam,
  canAccessAccount,
  grantInstanceAccessForAccount,
  normalizeEmail,
} from "./lib/teamAccess";
import { mutation, query } from "./_generated/server";

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
        role: r.role,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));

    return { invitations };
  },
});

export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const gate = await assertCanManageAccountTeam(ctx, args.accountId, userId);
    if (!gate) throw new Error("Not authorized");

    const normalized = normalizeEmail(args.email);
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
      .withIndex("by_account_email", (q) =>
        q.eq("accountId", args.accountId).eq("email", normalized),
      )
      .collect();

    const now = Date.now();
    const pending = existing.find((r) => r.status === "pending" && r.expiresAt > now);
    if (pending) {
      throw new Error("An invitation is already pending for this email");
    }

    const token = randomToken();
    const expiresAt = now + 14 * 24 * 60 * 60 * 1000;

    await ctx.db.insert("invitations", {
      accountId: args.accountId,
      email: normalized,
      role: args.role,
      token,
      invitedByUserId: userId,
      status: "pending",
      expiresAt,
      createdAt: now,
    });

    return { token, expiresAt };
  },
});

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
    const userEmail = typeof u.email === "string" ? normalizeEmail(u.email) : "";
    if (!userEmail || userEmail !== inv.email) {
      throw new Error("Sign in with the email address this invitation was sent to");
    }

    const existingMember = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) =>
        q.eq("accountId", inv.accountId).eq("userId", userId),
      )
      .first();

    if (existingMember) {
      await ctx.db.patch(inv._id, { status: "accepted" });
      return { accountId: inv.accountId, alreadyMember: true as const };
    }

    await ctx.db.insert("accountMembers", {
      accountId: inv.accountId,
      userId,
      role: inv.role,
      createdAt: now,
    });

    await grantInstanceAccessForAccount(ctx, inv.accountId, userId, inv.role);

    await ctx.db.patch(inv._id, { status: "accepted" });

    return { accountId: inv.accountId, alreadyMember: false as const };
  },
});
