import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import type { NotificationAudience, NotificationContent } from "./lib/notifications";

// In-app notifications. A notification's content is stored once in
// `notifications`; each recipient gets a `userNotifications` row holding only
// whether they have read it. Clearing deletes the row, never the notification.
// The backoffice creates and retracts notifications through the ops API
// (ops/notifications.ts); other Convex code sends them with sendNotification.

/** The most recent notifications the inbox shows. Older ones stay until cleared but are not listed. */
const INBOX_LIMIT = 30;
/** Inboxes written, or rows marked or deleted, per transaction. */
const BATCH = 200;

export type InboxNotification = {
  _id: Id<"userNotifications">;
  heading: string;
  description: string;
  link: string | null;
  read: boolean;
  createdAt: number;
};

/**
 * Stores a notification and starts delivering it to its audience in the
 * background. Delivery to every user takes one transaction per BATCH users.
 */
export async function sendNotification(
  ctx: MutationCtx,
  notification: NotificationContent & { audience: NotificationAudience; createdBy: string; requestId?: string }
): Promise<Id<"notifications">> {
  const notificationId = await ctx.db.insert("notifications", {
    heading: notification.heading,
    description: notification.description,
    link: notification.link ?? undefined,
    audience: notification.audience,
    recipients: 0,
    delivering: true,
    createdBy: notification.createdBy,
    requestId: notification.requestId,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliverBatch, { notificationId, cursor: null });
  return notificationId;
}

/** Deletes a notification at once and removes it from every inbox in the background. */
export async function retractNotification(ctx: MutationCtx, notificationId: Id<"notifications">): Promise<void> {
  await ctx.db.delete(notificationId);
  await ctx.scheduler.runAfter(0, internal.notifications.purgeBatch, { notificationId });
}

export const deliverBatch = internalMutation({
  args: { notificationId: v.id("notifications"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { notificationId, cursor }) => {
    const notification = await ctx.db.get(notificationId);
    if (notification === null) {
      // Retracted while delivering; purgeBatch removes what was delivered.
      return;
    }
    const { userIds, nextCursor } = await recipientPage(ctx, notification, cursor);
    for (const userId of userIds) {
      await ctx.db.insert("userNotifications", { userId, notificationId, read: false });
    }
    await ctx.db.patch(notificationId, {
      recipients: notification.recipients + userIds.length,
      delivering: nextCursor !== null,
    });
    if (nextCursor !== null) {
      await ctx.scheduler.runAfter(0, internal.notifications.deliverBatch, { notificationId, cursor: nextCursor });
    }
  },
});

async function recipientPage(
  ctx: MutationCtx,
  notification: Doc<"notifications">,
  cursor: string | null
): Promise<{ userIds: Id<"users">[]; nextCursor: string | null }> {
  const audience = notification.audience;
  switch (audience.kind) {
    case "all": {
      const result = await ctx.db.query("users").paginate({ numItems: BATCH, cursor });
      return { userIds: result.page.map((user) => user._id), nextCursor: result.isDone ? null : result.continueCursor };
    }
    case "account": {
      const result = await ctx.db
        .query("accountMembers")
        .withIndex("by_account", (index) => index.eq("accountId", audience.accountId))
        .paginate({ numItems: BATCH, cursor });
      return {
        userIds: result.page.map((member) => member.userId),
        nextCursor: result.isDone ? null : result.continueCursor,
      };
    }
    case "user": {
      const user = await ctx.db.get(audience.userId);
      return { userIds: user === null ? [] : [user._id], nextCursor: null };
    }
  }
}

export const purgeBatch = internalMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const rows = await ctx.db
      .query("userNotifications")
      .withIndex("by_notification", (index) => index.eq("notificationId", notificationId))
      .take(BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.notifications.purgeBatch, { notificationId });
    }
  },
});

/** Whether the signed-in user has anything unread, for the dot on the bell. */
export const hasUnread = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return false;
    }
    const unread = await ctx.db
      .query("userNotifications")
      .withIndex("by_user_read", (index) => index.eq("userId", userId).eq("read", false))
      .first();
    return unread !== null;
  },
});

/** The signed-in user's newest notifications, newest first. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<InboxNotification[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const rows = await ctx.db
      .query("userNotifications")
      .withIndex("by_user", (index) => index.eq("userId", userId))
      .order("desc")
      .take(INBOX_LIMIT);
    const inbox: InboxNotification[] = [];
    for (const row of rows) {
      const notification = await ctx.db.get(row.notificationId);
      // A retracted notification's rows outlive it until purgeBatch reaches them.
      if (notification === null) {
        continue;
      }
      inbox.push({
        _id: row._id,
        heading: notification.heading,
        description: notification.description,
        link: notification.link ?? null,
        read: row.read,
        createdAt: notification._creationTime,
      });
    }
    return inbox;
  },
});

async function ownRow(ctx: MutationCtx, id: Id<"userNotifications">): Promise<Doc<"userNotifications"> | null> {
  const userId = await requireUserId(ctx);
  const row = await ctx.db.get(id);
  // Someone else's row reads as already gone, so ids reveal nothing.
  return row !== null && row.userId === userId ? row : null;
}

async function requireUserId(ctx: MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Sign in to manage notifications");
  }
  return userId;
}

export const markRead = mutation({
  args: { id: v.id("userNotifications") },
  handler: async (ctx, { id }) => {
    const row = await ownRow(ctx, id);
    if (row !== null && !row.read) {
      await ctx.db.patch(row._id, { read: true });
    }
  },
});

export const dismiss = mutation({
  args: { id: v.id("userNotifications") },
  handler: async (ctx, { id }) => {
    const row = await ownRow(ctx, id);
    if (row !== null) {
      await ctx.db.delete(row._id);
    }
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    await markAllReadBatch(ctx, await requireUserId(ctx));
  },
});

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    await clearAllBatch(ctx, await requireUserId(ctx));
  },
});

export const continueMarkAllRead = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await markAllReadBatch(ctx, userId);
  },
});

export const continueClearAll = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await clearAllBatch(ctx, userId);
  },
});

async function markAllReadBatch(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const unread = await ctx.db
    .query("userNotifications")
    .withIndex("by_user_read", (index) => index.eq("userId", userId).eq("read", false))
    .take(BATCH);
  for (const row of unread) {
    await ctx.db.patch(row._id, { read: true });
  }
  if (unread.length === BATCH) {
    await ctx.scheduler.runAfter(0, internal.notifications.continueMarkAllRead, { userId });
  }
}

async function clearAllBatch(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const rows = await ctx.db
    .query("userNotifications")
    .withIndex("by_user", (index) => index.eq("userId", userId))
    .take(BATCH);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  if (rows.length === BATCH) {
    await ctx.scheduler.runAfter(0, internal.notifications.continueClearAll, { userId });
  }
}
