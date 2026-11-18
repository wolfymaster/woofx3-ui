import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { type ReferralDto, referralDto } from "../lib/ops/dto";
import { ownedAccountOf } from "../org/membership";
import { referralForAccount, rewardEligibility } from "../referrals";

export const forAccount = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, args): Promise<ReferralDto | null> => {
    const accountId = ctx.db.normalizeId("accounts", args.accountId);
    const referral = accountId ? await referralForAccount(ctx, accountId) : null;
    if (referral === null) {
      return null;
    }
    const referrerAccount = await ownedAccountOf(ctx, referral.referrerUserId);
    const eligible = await rewardEligibility(ctx, referral, referrerAccount?._id ?? null);
    return referralDto(referral, referrerAccount?._id ?? null, eligible);
  },
});
