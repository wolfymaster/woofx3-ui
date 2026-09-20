import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, type QueryCtx, query } from "./_generated/server";
import { planRepin } from "./lib/pinStrategy";
import { getInstanceMembership } from "./lib/teamAccess";
import { authorizeTwitch } from "./lib/twitchAuth";

// Twitch chat pinning, and the local history it is driven from.
//
// Twitch keeps exactly one pinned message per channel and pins an existing
// message by id; pinning a new one silently replaces the old. So there is no
// "list of pins" to mirror — there is one slot, and this module's history is
// the list of things worth putting in it.
//
// Reading the current pin returns timing only (message id, created/updated,
// expiry) and carries neither the message text nor its author, so a pin made
// from Twitch's own UI can only ever be reported as "something is pinned". Text
// is shown when the id matches an entry we recorded ourselves.
//
// These endpoints are in open beta as of 2026-05-15 and may change.

const TWITCH_PINS_URL = "https://api.twitch.tv/helix/chat/pins";
const TWITCH_MESSAGES_URL = "https://api.twitch.tv/helix/chat/messages";

const PIN_MANAGE_SCOPE = "moderator:manage:chat_messages";
const PIN_READ_SCOPE = "moderator:read:chat_messages";
const SEND_SCOPE = "user:write:chat";

/** Twitch rejects a chat message longer than this, so refuse before spending a call. */
const MAX_MESSAGE_LENGTH = 500;

const MAX_HISTORY_READ = 100;

async function requireMember(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  if (!(await getInstanceMembership(ctx, instanceId, userId))) {
    throw new Error("Not a member of this instance");
  }
  return userId;
}

function toHistoryEntry(row: Doc<"pinnedMessages">) {
  return {
    id: row._id,
    content: row.content,
    authorName: row.authorName,
    twitchMessageId: row.twitchMessageId,
    createdAt: row.pinnedAt,
    lastPinnedAt: row.lastPinnedAt,
  };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export const listHistory = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await getInstanceMembership(ctx, args.instanceId, userId))) {
      return [];
    }
    const rows = await ctx.db
      .query("pinnedMessages")
      .withIndex("by_instance_pinned_at", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .take(MAX_HISTORY_READ);
    return rows.map(toHistoryEntry);
  },
});

export const removeFromHistory = mutation({
  args: { instanceId: v.id("instances"), entryId: v.id("pinnedMessages") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.instanceId);
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.instanceId !== args.instanceId) {
      throw new Error("History entry not found");
    }
    await ctx.db.delete(args.entryId);
  },
});

// ---------------------------------------------------------------------------
// Internal state used by the actions
// ---------------------------------------------------------------------------

export const historyEntry = internalQuery({
  args: { entryId: v.id("pinnedMessages") },
  handler: async (ctx, args): Promise<Doc<"pinnedMessages"> | null> => {
    return ctx.db.get(args.entryId);
  },
});

/**
 * The current session's start as epoch ms, so a message id minted during an
 * earlier session is not retried.
 *
 * Keyed on the session rather than the broadcast: a session spans brief
 * dropouts, so a reconnect would otherwise move the boundary and throw away
 * message ids that are still perfectly pinnable.
 *
 * instanceLiveState stores it as an ISO string (straight off the engine's
 * SessionStarted event) while history timestamps are epoch ms, so this converts
 * rather than handing planRepin two different units. An absent or unparseable
 * value yields null, which planRepin reads as "boundary unknown" and
 * optimistically tries the id.
 */
export const sessionStartedAt = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<number | null> => {
    const live = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();
    // No isLive gate: a session stays current while the stream is down, so
    // being offline does not make the boundary unknown.
    if (!live?.sessionStartedAt) {
      return null;
    }
    const parsed = Date.parse(live.sessionStartedAt);
    return Number.isNaN(parsed) ? null : parsed;
  },
});

export const recordPinned = internalMutation({
  args: {
    instanceId: v.id("instances"),
    userId: v.id("users"),
    content: v.string(),
    twitchMessageId: v.optional(v.string()),
    entryId: v.optional(v.id("pinnedMessages")),
    at: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"pinnedMessages">> => {
    // Re-pinning an existing entry updates it in place rather than adding a
    // duplicate: the history is "things worth pinning", not a pin log.
    if (args.entryId) {
      const existing = await ctx.db.get(args.entryId);
      if (existing && existing.instanceId === args.instanceId) {
        await ctx.db.patch(args.entryId, {
          lastPinnedAt: args.at,
          // A re-post mints a new id; keep it so the next re-pin can reuse it.
          ...(args.twitchMessageId ? { twitchMessageId: args.twitchMessageId } : {}),
        });
        return args.entryId;
      }
    }

    return ctx.db.insert("pinnedMessages", {
      instanceId: args.instanceId,
      content: args.content,
      twitchMessageId: args.twitchMessageId,
      pinnedAt: args.at,
      lastPinnedAt: args.at,
      pinnedByUserId: args.userId,
    });
  },
});

// ---------------------------------------------------------------------------
// Twitch
// ---------------------------------------------------------------------------

interface TwitchPin {
  messageId: string;
  createdAt?: string;
  expiresAt?: string;
}

async function fetchCurrentPin(
  accessToken: string,
  clientId: string,
  broadcasterUserId: string
): Promise<TwitchPin | null> {
  const url = `${TWITCH_PINS_URL}?broadcaster_id=${broadcasterUserId}&moderator_id=${broadcasterUserId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
  });
  if (!response.ok) {
    throw new Error(`Twitch pin lookup failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    data?: Array<{ message_id?: string; created_at?: string; expires_at?: string }>;
  };
  const pin = body.data?.[0];
  if (!pin?.message_id) {
    return null;
  }
  return { messageId: pin.message_id, createdAt: pin.created_at, expiresAt: pin.expires_at };
}

/**
 * What Twitch currently has pinned, with our own text attached when we
 * recognise the message id.
 *
 * `content` is null for a pin made outside this app — Twitch does not return
 * the message text, and nothing here receives chat, so there is no way to learn
 * what it says.
 */
export const currentPin = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<{ messageId: string; content: string | null; expiresAt?: string } | null> => {
    const { accessToken, broadcasterUserId, clientId } = await authorizeTwitch(ctx, args.instanceId, PIN_READ_SCOPE);
    const pin = await fetchCurrentPin(accessToken, clientId, broadcasterUserId);
    if (!pin) {
      return null;
    }

    const known: Array<{ twitchMessageId?: string; content: string }> = await ctx.runQuery(
      internal.pins.knownMessages,
      { instanceId: args.instanceId }
    );
    const match = known.find((entry) => entry.twitchMessageId === pin.messageId);
    return { messageId: pin.messageId, content: match?.content ?? null, expiresAt: pin.expiresAt };
  },
});

export const knownMessages = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<Array<{ twitchMessageId?: string; content: string }>> => {
    const rows = await ctx.db
      .query("pinnedMessages")
      .withIndex("by_instance_pinned_at", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .take(MAX_HISTORY_READ);
    return rows.map((row) => ({ twitchMessageId: row.twitchMessageId, content: row.content }));
  },
});

/** Posts `text` to chat and pins it in one request, returning the new message id. */
async function sendAndPin(
  accessToken: string,
  clientId: string,
  broadcasterUserId: string,
  text: string
): Promise<string> {
  const response = await fetch(TWITCH_MESSAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      broadcaster_id: broadcasterUserId,
      sender_id: broadcasterUserId,
      message: text,
      pin: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Twitch send-and-pin failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as {
    data?: Array<{ message_id?: string; is_sent?: boolean; drop_reason?: { code?: string; message?: string } }>;
  };
  const result = body.data?.[0];
  // Twitch answers 200 and still drops the message — automod, a duplicate, a
  // banned term. Treating that as success would record an id nobody ever saw.
  if (!result?.is_sent) {
    throw new Error(result?.drop_reason?.message ?? "Twitch accepted the message but did not send it");
  }
  if (!result.message_id) {
    throw new Error("Twitch sent the message but returned no id");
  }
  return result.message_id;
}

async function pinExisting(
  accessToken: string,
  clientId: string,
  broadcasterUserId: string,
  messageId: string
): Promise<void> {
  const url = `${TWITCH_PINS_URL}?broadcaster_id=${broadcasterUserId}&moderator_id=${broadcasterUserId}&message_id=${encodeURIComponent(messageId)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
  });
  if (!response.ok) {
    throw new Error(`Twitch pin failed: ${response.status} ${await response.text()}`);
  }
}

/** Post a new message and pin it, recording it in history. */
export const pinNewMessage = action({
  args: { instanceId: v.id("instances"), text: v.string() },
  handler: async (ctx, args): Promise<{ messageId: string }> => {
    const text = args.text.trim();
    if (!text) {
      throw new Error("A pinned message needs some text");
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Chat messages are limited to ${MAX_MESSAGE_LENGTH} characters`);
    }

    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    // Both scopes are needed: one to post the message, one to pin it.
    const { accessToken, broadcasterUserId, clientId } = await authorizeTwitch(ctx, args.instanceId, SEND_SCOPE);
    await authorizeTwitch(ctx, args.instanceId, PIN_MANAGE_SCOPE);

    const messageId = await sendAndPin(accessToken, clientId, broadcasterUserId, text);
    await ctx.runMutation(internal.pins.recordPinned, {
      instanceId: args.instanceId,
      userId,
      content: text,
      twitchMessageId: messageId,
      at: Date.now(),
    });
    return { messageId };
  },
});

/**
 * Pin a history entry again.
 *
 * planRepin decides whether the stored message id is still worth trying; a
 * refusal falls back to re-posting the text, because an id can expire for
 * reasons the rule cannot see.
 */
export const repinFromHistory = action({
  args: { instanceId: v.id("instances"), entryId: v.id("pinnedMessages") },
  handler: async (ctx, args): Promise<{ messageId: string; resent: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const entry: Doc<"pinnedMessages"> | null = await ctx.runQuery(internal.pins.historyEntry, {
      entryId: args.entryId,
    });
    if (!entry || entry.instanceId !== args.instanceId) {
      throw new Error("History entry not found");
    }

    const { accessToken, broadcasterUserId, clientId } = await authorizeTwitch(ctx, args.instanceId, PIN_MANAGE_SCOPE);
    // null, not undefined: Convex turns an undefined return into null across
    // the function boundary. planRepin takes undefined for "boundary unknown",
    // so the conversion happens here rather than widening its signature to
    // carry a transport detail.
    const startedAt: number | null = await ctx.runQuery(internal.pins.sessionStartedAt, {
      instanceId: args.instanceId,
    });

    const plan = planRepin(
      { twitchMessageId: entry.twitchMessageId, createdAt: entry.pinnedAt, content: entry.content },
      startedAt ?? undefined
    );

    let messageId = plan.kind === "repin" ? plan.messageId : "";
    let resent = plan.kind === "resend";

    if (plan.kind === "repin") {
      try {
        await pinExisting(accessToken, clientId, broadcasterUserId, plan.messageId);
      } catch {
        // The id outlived the rule's guess — post the text instead. This is the
        // path planRepin exists to keep rare, not to replace.
        resent = true;
      }
    }

    if (resent) {
      await authorizeTwitch(ctx, args.instanceId, SEND_SCOPE);
      messageId = await sendAndPin(accessToken, clientId, broadcasterUserId, entry.content);
    }

    await ctx.runMutation(internal.pins.recordPinned, {
      instanceId: args.instanceId,
      userId,
      content: entry.content,
      twitchMessageId: messageId,
      entryId: args.entryId,
      at: Date.now(),
    });

    return { messageId, resent };
  },
});

export const unpinCurrent = action({
  args: { instanceId: v.id("instances"), messageId: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { accessToken, broadcasterUserId, clientId } = await authorizeTwitch(ctx, args.instanceId, PIN_MANAGE_SCOPE);

    const url = `${TWITCH_PINS_URL}?broadcaster_id=${broadcasterUserId}&moderator_id=${broadcasterUserId}&message_id=${encodeURIComponent(args.messageId)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
    });
    if (!response.ok) {
      throw new Error(`Twitch unpin failed: ${response.status} ${await response.text()}`);
    }
    return { ok: true };
  },
});
