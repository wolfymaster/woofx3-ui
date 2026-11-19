import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { recordOpsAudit } from "../lib/ops/audit";
import { type ReferralCodeDto, referralCodeDto } from "../lib/ops/dto";
import { normalizeEmail } from "../lib/teamAccess";

/**
 * Referral codes as operators manage them. Codes exist only because an
 * operator issued one to a person; users cannot make their own. Every write
 * is audited in the same mutation as the change, refused attempts included.
 */

const PAGE_SIZE = 25;
const MAX_COUNTED_REFERRALS = 1000;
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 10;
const MAX_CODE_ATTEMPTS = 5;

export type ReferralCodeWriteResult =
  | { ok: true; result: ReferralCodeDto }
  | { ok: false; status: 404 | 409; code: string; message: string };

type Action = "referralCodes.issue" | "referralCodes.update" | "referralCodes.revoke";

interface Writer {
  caller: string;
  actor: string;
  reason: string;
}

const writerArgs = { caller: v.string(), actor: v.string(), reason: v.string() };

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export const list = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ codes: ReferralCodeDto[]; cursor: string | null }> => {
    const result = await ctx.db.query("referralCodes").order("desc").paginate({ numItems: PAGE_SIZE, cursor });
    return {
      codes: await Promise.all(result.page.map((row) => toDto(ctx, row))),
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const issue = internalMutation({
  args: { email: v.string(), rewardCents: v.number(), issuedBy: v.string(), ...writerArgs },
  handler: async (ctx, { email, rewardCents, issuedBy, ...writer }): Promise<ReferralCodeWriteResult> => {
    const request = { email, rewardCents, issuedBy };
    const user = await ctx.db
      .query("users")
      .withIndex("email", (index) => index.eq("email", normalizeEmail(email)))
      .first();
    if (user === null) {
      return refuse(ctx, writer, "referralCodes.issue", email, request, {
        status: 404,
        code: "user_not_found",
        message: "No user has that email",
      });
    }
    const held = await ctx.db
      .query("referralCodes")
      .withIndex("by_user", (index) => index.eq("userId", user._id))
      .collect();
    if (held.some((row) => row.revokedAt === undefined)) {
      return refuse(ctx, writer, "referralCodes.issue", email, request, {
        status: 409,
        code: "code_exists",
        message: "That user already has a referral code",
      });
    }
    const code = await unusedCode(ctx);
    const id = await ctx.db.insert("referralCodes", {
      userId: user._id,
      code,
      createdAt: Date.now(),
      rewardCents,
      issuedBy,
    });
    const row = await ctx.db.get(id);
    if (row === null) {
      throw new Error("A referral code inserted in this transaction is missing");
    }
    await audit(ctx, writer, "referralCodes.issue", code, request, "ok");
    return { ok: true, result: await toDto(ctx, row) };
  },
});

export const update = internalMutation({
  args: { code: v.string(), rewardCents: v.number(), updatedBy: v.string(), ...writerArgs },
  handler: async (ctx, { code, rewardCents, updatedBy, ...writer }): Promise<ReferralCodeWriteResult> => {
    const row = await byCode(ctx, code);
    const request = { rewardCents, updatedBy, from: row?.rewardCents ?? null };
    if (row === null) {
      return refuse(ctx, writer, "referralCodes.update", code, request, notFound);
    }
    if (row.revokedAt !== undefined) {
      return refuse(ctx, writer, "referralCodes.update", code, request, revoked);
    }
    await ctx.db.patch(row._id, { rewardCents });
    await audit(ctx, writer, "referralCodes.update", code, request, "ok");
    return { ok: true, result: await toDto(ctx, { ...row, rewardCents }) };
  },
});

export const revoke = internalMutation({
  args: { code: v.string(), revokedBy: v.string(), ...writerArgs },
  handler: async (ctx, { code, revokedBy, ...writer }): Promise<ReferralCodeWriteResult> => {
    const row = await byCode(ctx, code);
    const request = { revokedBy };
    if (row === null) {
      return refuse(ctx, writer, "referralCodes.revoke", code, request, notFound);
    }
    // Revoking again keeps the first revocation time.
    const revokedAt = row.revokedAt ?? Date.now();
    if (row.revokedAt === undefined) {
      await ctx.db.patch(row._id, { revokedAt });
    }
    await audit(ctx, writer, "referralCodes.revoke", code, request, "ok");
    return { ok: true, result: await toDto(ctx, { ...row, revokedAt }) };
  },
});

const notFound = { status: 404, code: "not_found", message: "No such referral code" } as const;
const revoked = { status: 409, code: "code_revoked", message: "That referral code is revoked" } as const;

function byCode(ctx: MutationCtx, code: string): Promise<Doc<"referralCodes"> | null> {
  return ctx.db
    .query("referralCodes")
    .withIndex("by_code", (index) => index.eq("code", code))
    .first();
}

async function unusedCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomCode();
    if ((await byCode(ctx, code)) === null) {
      return code;
    }
  }
  throw new Error("Could not find an unused referral code");
}

async function toDto(ctx: QueryCtx, row: Doc<"referralCodes">): Promise<ReferralCodeDto> {
  const [user, referrals] = await Promise.all([
    ctx.db.get(row.userId),
    ctx.db
      .query("referrals")
      .withIndex("by_code", (index) => index.eq("code", row.code))
      .take(MAX_COUNTED_REFERRALS),
  ]);
  return referralCodeDto(row, user?.email ?? null, referrals.length);
}

async function refuse(
  ctx: MutationCtx,
  writer: Writer,
  action: Action,
  target: string,
  request: Record<string, unknown>,
  refusal: { status: 404 | 409; code: string; message: string }
): Promise<ReferralCodeWriteResult> {
  await audit(ctx, writer, action, target, request, refusal.code);
  return { ok: false, ...refusal };
}

function audit(
  ctx: MutationCtx,
  writer: Writer,
  action: Action,
  target: string,
  request: Record<string, unknown>,
  result: string
): Promise<void> {
  return recordOpsAudit(ctx, { ...writer, action, target, request, result });
}
