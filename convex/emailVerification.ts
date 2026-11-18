import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { spendActionLimit } from "./lib/actionRateLimits";
import {
  cryptoRandomInt,
  EMAIL_VERIFICATION,
  hashVerificationCode,
  newVerificationCode,
  type RandomInt,
  type VerificationMailer,
  verificationMailerFromEnv,
} from "./lib/emailVerification";
import { normalizeEmail } from "./lib/teamAccess";
import { logger } from "./logger";
import { isEmailVerified } from "./org/identity";

// Proving ownership of the account's email address with a mailed code. A
// verified address is what lets the account accept an email invitation.

export type RequestRefusal = { code: "email_unavailable" | "email_send_failed" | "no_email"; message: string };

export interface VerificationDeps {
  randomInt: RandomInt;
  mailer: VerificationMailer;
}

/** Stores a fresh code for the user and mails it. Throws when it cannot be mailed. */
export async function issueVerificationCode(
  ctx: Pick<ActionCtx, "runMutation">,
  deps: VerificationDeps,
  target: { userId: Id<"users">; email: string }
): Promise<void> {
  const code = newVerificationCode(deps.randomInt);
  const codeHash = await hashVerificationCode(target.userId, code);
  await ctx.runMutation(internal.emailVerification.storeCode, {
    userId: target.userId,
    email: normalizeEmail(target.email),
    codeHash,
  });
  await deps.mailer.sendCode({ to: target.email, code, idempotencyKey: `verify-email:${target.userId}:${codeHash}` });
}

export const verificationTarget = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      return null;
    }
    return { email: user.email ?? null, verified: isEmailVerified(user) };
  },
});

export const storeCode = internalMutation({
  args: { userId: v.id("users"), email: v.string(), codeHash: v.string() },
  handler: async (ctx, args) => {
    const row = {
      userId: args.userId,
      email: args.email,
      codeHash: args.codeHash,
      expiresAt: Date.now() + EMAIL_VERIFICATION.codeTtlMs,
      failedAttempts: 0,
    };
    const existing = await ctx.db
      .query("emailVerificationCodes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (existing === null) {
      await ctx.db.insert("emailVerificationCodes", row);
    } else {
      await ctx.db.replace(existing._id, row);
    }
  },
});

/** Whether the signed-in user's address is verified, and which address a code goes to. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const user = userId === null ? null : await ctx.db.get(userId);
    if (user === null) {
      return null;
    }
    return { email: user.email ?? null, verified: isEmailVerified(user) };
  },
});

/** Mails the signed-in user a code for their address. */
export const request = action({
  args: {},
  handler: async (ctx): Promise<{ status: "sent" | "already_verified" }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError({ code: "unauthenticated", message: "Sign in to verify your email." });
    }
    const target = await ctx.runQuery(internal.emailVerification.verificationTarget, { userId });
    if (target === null || target.email === null || target.email === "") {
      throw new ConvexError<RequestRefusal>({
        code: "no_email",
        message: "Your account has no email address to verify.",
      });
    }
    if (target.verified) {
      return { status: "already_verified" };
    }
    await spendActionLimit(ctx, "emailVerificationSend", userId);
    const mailer = verificationMailerFromEnv(process.env);
    if (mailer === null) {
      throw new ConvexError<RequestRefusal>({
        code: "email_unavailable",
        message: "Email verification isn't available on this deployment.",
      });
    }
    try {
      await issueVerificationCode(ctx, { randomInt: cryptoRandomInt, mailer }, { userId, email: target.email });
    } catch (error) {
      logger.error("verification email failed", { userId, error: String(error) });
      throw new ConvexError<RequestRefusal>({
        code: "email_send_failed",
        message: "We couldn't send the code. Try again in a moment.",
      });
    }
    return { status: "sent" };
  },
});

/** Sends the first code right after a password sign-up. A failure is logged; the person can request again. */
export const sendAtSignUp = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.emailVerification.verificationTarget, { userId: args.userId });
    const mailer = verificationMailerFromEnv(process.env);
    if (target === null || target.email === null || target.verified || mailer === null) {
      return;
    }
    try {
      await issueVerificationCode(
        ctx,
        { randomInt: cryptoRandomInt, mailer },
        { userId: args.userId, email: target.email }
      );
    } catch (error) {
      logger.error("sign-up verification email failed", { userId: args.userId, error: String(error) });
    }
  },
});

export type ConfirmOutcome = { status: "verified" | "invalid" | "expired" | "no_code" | "too_many_attempts" };

/**
 * Checks a typed code. Refusals are returned rather than thrown: a thrown
 * error would roll back the failed-attempt count that limits guessing.
 */
export const confirm = mutation({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<ConfirmOutcome> => {
    const userId = await getAuthUserId(ctx);
    const user = userId === null ? null : await ctx.db.get(userId);
    if (userId === null || user === null) {
      throw new ConvexError({ code: "unauthenticated", message: "Sign in to verify your email." });
    }
    const row = await ctx.db
      .query("emailVerificationCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (row === null || typeof user.email !== "string" || row.email !== normalizeEmail(user.email)) {
      return { status: "no_code" };
    }
    if (row.expiresAt <= Date.now()) {
      return { status: "expired" };
    }
    if (row.failedAttempts >= EMAIL_VERIFICATION.maxFailedAttempts) {
      return { status: "too_many_attempts" };
    }
    if ((await hashVerificationCode(userId, args.code.trim())) !== row.codeHash) {
      await ctx.db.patch(row._id, { failedAttempts: row.failedAttempts + 1 });
      return { status: "invalid" };
    }
    await ctx.db.patch(userId, { emailVerificationTime: Date.now() });
    await ctx.db.delete(row._id);
    return { status: "verified" };
  },
});
