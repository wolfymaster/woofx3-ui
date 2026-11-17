import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireClient, requireUser } from "./billingCommands";
import type { PlanPrice } from "./lib/billingClient";
import { billingIntervalValidator, planTierValidator } from "./lib/organization";

const priceValidator = v.object({
  plan: planTierValidator,
  interval: billingIntervalValidator,
  amountCents: v.number(),
  currency: v.literal("usd"),
});

/**
 * What the plan chooser shows. `unavailable` means the plane has not answered and no earlier answer is kept; the page
 * says so rather than guessing a price. `names` are the plan rows' display names, keyed by tier.
 */
export type PlanPriceListing =
  | { state: "ready"; prices: PlanPrice[]; names: Record<string, string> }
  | { state: "unavailable"; names: Record<string, string> };

export const cached = internalQuery({
  args: {},
  handler: async (ctx): Promise<PlanPrice[] | null> => {
    const row = await ctx.db.query("planPriceCache").first();
    return row === null ? null : row.prices;
  },
});

export const remember = internalMutation({
  args: { prices: v.array(priceValidator), fetchedAt: v.number() },
  handler: async (ctx, { prices, fetchedAt }): Promise<null> => {
    const row = await ctx.db.query("planPriceCache").first();
    if (row === null) {
      await ctx.db.insert("planPriceCache", { prices, fetchedAt });
    } else {
      await ctx.db.replace(row._id, { prices, fetchedAt });
    }
    return null;
  },
});

export const planNames = internalQuery({
  args: {},
  handler: async (ctx): Promise<Record<string, string>> => {
    const plans = await ctx.db.query("plans").take(200);
    return Object.fromEntries(plans.map((plan) => [plan.key, plan.name]));
  },
});

/**
 * The plane's current list prices. An answer is kept as the last good value; when the plane does not answer, that
 * value is served instead, and with none the listing is `unavailable`. No price is ever written in code.
 */
export const list = action({
  args: {},
  handler: async (ctx): Promise<PlanPriceListing> => {
    await requireUser(ctx);
    const names = await ctx.runQuery(internal.prices.planNames, {});
    const answer = await requireClient().planPrices();
    if (answer.ok) {
      await ctx.runMutation(internal.prices.remember, { prices: answer.value, fetchedAt: Date.now() });
      return { state: "ready", prices: answer.value, names };
    }
    const kept = await ctx.runQuery(internal.prices.cached, {});
    return kept === null ? { state: "unavailable", names } : { state: "ready", prices: kept, names };
  },
});
