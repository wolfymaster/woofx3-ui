import { getAuthUserId } from "@convex-dev/auth/server";
import type { Infer } from "convex/values";
import { mutation, query } from "./_generated/server";
import { pageIntroIdValidator } from "./schema";

type PageIntroId = Infer<typeof pageIntroIdValidator>;

// Bounds the read; there is one row per intro, and only a handful of intros.
const MAX_INTROS = 50;

/** The intros the signed-in user has dismissed. Empty when signed out. */
export const listDismissed = query({
  args: {},
  handler: async (ctx): Promise<PageIntroId[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const rows = await ctx.db
      .query("pageIntroDismissals")
      .withIndex("by_user_and_intro", (q) => q.eq("userId", userId))
      .take(MAX_INTROS);
    return rows.map((row) => row.introId);
  },
});

export const dismiss = mutation({
  args: { introId: pageIntroIdValidator },
  handler: async (ctx, { introId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const existing = await ctx.db
      .query("pageIntroDismissals")
      .withIndex("by_user_and_intro", (q) => q.eq("userId", userId).eq("introId", introId))
      .first();
    if (existing) {
      return;
    }
    await ctx.db.insert("pageIntroDismissals", { userId, introId, dismissedAt: Date.now() });
  },
});
