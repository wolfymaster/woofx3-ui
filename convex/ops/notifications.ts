import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import type { NotificationAudience } from "../lib/notifications";
import { recordOpsAudit } from "../lib/ops/audit";
import { type NotificationDto, notificationDto } from "../lib/ops/dto";
import { retractNotification, sendNotification } from "../notifications";
import type { Page } from "./reads";

const PAGE_SIZE = 50;

export type NotificationWriteResult<T> =
  | { ok: true; result: T }
  | { ok: false; status: 404; code: "not_found"; message: string };

export const list = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<Page<NotificationDto>> => {
    const result = await ctx.db.query("notifications").order("desc").paginate({ numItems: PAGE_SIZE, cursor });
    return { page: result.page.map(notificationDto), cursor: result.isDone ? null : result.continueCursor };
  },
});

/**
 * Creates a notification an operator wrote. The HTTP handler has already
 * checked its content (lib/notifications.ts); this resolves the audience's
 * ids, which only the database can, and answers a repeated requestId with
 * the notification it created first.
 */
export const create = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    requestId: v.string(),
    heading: v.string(),
    description: v.string(),
    link: v.union(v.string(), v.null()),
    audience: v.union(
      v.object({ kind: v.literal("all") }),
      v.object({ kind: v.literal("account"), accountId: v.string() }),
      v.object({ kind: v.literal("user"), userId: v.string() })
    ),
  },
  handler: async (ctx, args): Promise<NotificationWriteResult<NotificationDto>> => {
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_request_id", (index) => index.eq("requestId", args.requestId))
      .unique();
    if (existing !== null) {
      return { ok: true, result: notificationDto(existing) };
    }

    let audience: NotificationAudience;
    if (args.audience.kind === "account") {
      const accountId = ctx.db.normalizeId("accounts", args.audience.accountId);
      if (accountId === null || (await ctx.db.get(accountId)) === null) {
        return { ok: false, status: 404, code: "not_found", message: "No such account" };
      }
      audience = { kind: "account", accountId };
    } else if (args.audience.kind === "user") {
      const userId = ctx.db.normalizeId("users", args.audience.userId);
      if (userId === null || (await ctx.db.get(userId)) === null) {
        return { ok: false, status: 404, code: "not_found", message: "No such user" };
      }
      audience = { kind: "user", userId };
    } else {
      audience = { kind: "all" };
    }

    const notificationId = await sendNotification(ctx, {
      heading: args.heading,
      description: args.description,
      link: args.link,
      audience,
      createdBy: args.actor,
      requestId: args.requestId,
    });
    await recordOpsAudit(ctx, {
      actor: args.actor,
      action: "notifications.create",
      target: notificationId,
      reason: args.reason,
      request: { heading: args.heading, description: args.description, link: args.link, audience: args.audience },
      result: "ok",
    });
    const created = await ctx.db.get(notificationId);
    if (created === null) {
      throw new Error("A notification inserted in this transaction is missing");
    }
    return { ok: true, result: notificationDto(created) };
  },
});

export const remove = internalMutation({
  args: { actor: v.string(), reason: v.string(), notificationId: v.string() },
  handler: async (ctx, { actor, reason, notificationId }): Promise<NotificationWriteResult<{ id: string }>> => {
    const id: Id<"notifications"> | null = ctx.db.normalizeId("notifications", notificationId);
    const notification = id === null ? null : await ctx.db.get(id);
    if (id === null || notification === null) {
      return { ok: false, status: 404, code: "not_found", message: "No such notification" };
    }
    await retractNotification(ctx, id);
    await recordOpsAudit(ctx, {
      actor,
      action: "notifications.delete",
      target: id,
      reason,
      request: { heading: notification.heading },
      result: "ok",
    });
    return { ok: true, result: { id } };
  },
});
