import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { type ReferralDto, referralDto } from "../lib/ops/dto";
import { referralForAccount } from "../referrals";

export const forAccount = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, args): Promise<ReferralDto | null> => {
    const accountId = ctx.db.normalizeId("accounts", args.accountId);
    const referral = accountId ? await referralForAccount(ctx, accountId) : null;
    return referral === null ? null : referralDto(referral);
  },
});
