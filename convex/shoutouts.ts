import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  earliestEligibleAt,
  nextSendAt,
  pickNextEntry,
  retryDelayMs,
  SHOUTOUT_COOLDOWN_MS,
} from "./lib/shoutoutSchedule";
import { getInstanceMembership } from "./lib/teamAccess";
import { authorizeTwitch, authorizeTwitchUnattended } from "./lib/twitchAuth";

const TWITCH_CHATTERS_URL = "https://api.twitch.tv/helix/chat/chatters";
const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";
const TWITCH_SHOUTOUTS_URL = "https://api.twitch.tv/helix/chat/shoutouts";

const CHATTERS_SCOPE = "moderator:read:chatters";
const SHOUTOUT_SCOPE = "moderator:manage:shoutouts";

// Helix caps a chatters page at 1000. A channel with more concurrent chatters
// than that does not need an autocomplete built on a full roster, so this reads
// one page rather than paginating.
const CHATTERS_PAGE_SIZE = 1000;

const MAX_QUEUE_READ = 200;

async function requireMember(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const membership = await getInstanceMembership(ctx, instanceId, userId);
  if (!membership) {
    throw new Error("Not a member of this instance");
  }
  return userId;
}

function toQueueEntry(row: Doc<"shoutoutQueue">) {
  return {
    id: row._id,
    login: row.login,
    displayName: row.displayName,
    profileImageUrl: row.profileImageUrl,
    broadcasterType: row.broadcasterType,
    attempts: row.attempts,
    nextEligibleAt: row.nextEligibleAt,
    lastError: row.lastError,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The instance's pending shoutouts, in queue order. */
export const listQueue = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    // A non-member sees an empty queue rather than an error, matching
    // dashboardLayouts.getPanels -- the widget renders its empty state instead
    // of tearing the dashboard down.
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    if (!(await getInstanceMembership(ctx, args.instanceId, userId))) {
      return [];
    }

    const rows = await ctx.db
      .query("shoutoutQueue")
      .withIndex("by_instance_and_sort_order", (q) => q.eq("instanceId", args.instanceId))
      .take(MAX_QUEUE_READ);

    return rows.map(toQueueEntry);
  },
});

/**
 * Everyone currently in chat, for the shoutout autocomplete.
 *
 * Nothing in woofx3 tracks chat presence -- the only signal anywhere is the
 * per-message event, and no service accumulates it -- so this asks Twitch
 * directly. Callers fetch the roster once and filter locally rather than
 * calling per keystroke.
 */
export const listChatters = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<Array<{ userId: string; login: string; displayName: string }>> => {
    const { accessToken, broadcasterUserId, clientId } = await authorizeTwitch(ctx, args.instanceId, CHATTERS_SCOPE);

    const url = `${TWITCH_CHATTERS_URL}?broadcaster_id=${broadcasterUserId}&moderator_id=${broadcasterUserId}&first=${CHATTERS_PAGE_SIZE}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
    });
    if (!response.ok) {
      throw new Error(`Twitch chatters lookup failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as {
      data: Array<{ user_id: string; user_login: string; user_name: string }>;
    };
    return body.data.map((chatter) => ({
      userId: chatter.user_id,
      login: chatter.user_login,
      displayName: chatter.user_name,
    }));
  },
});

/**
 * Identity for the confirmation step: who is about to be shouted out, and are
 * they partner/affiliate. Looked up before queueing so a mistyped name is
 * caught by a face rather than by a shoutout to the wrong channel.
 */
export const lookupUser = action({
  args: { instanceId: v.id("instances"), login: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    twitchUserId: string;
    login: string;
    displayName: string;
    profileImageUrl?: string;
    broadcasterType?: string;
  } | null> => {
    const login = args.login.trim().toLowerCase().replace(/^@/, "");
    if (!login) {
      return null;
    }

    // The shoutout scope is the one this lookup exists to serve; checking it
    // here means a missing permission surfaces at confirmation time rather than
    // two minutes later inside the queue processor.
    const { accessToken, clientId } = await authorizeTwitch(ctx, args.instanceId, SHOUTOUT_SCOPE);

    const response = await fetch(`${TWITCH_USERS_URL}?login=${encodeURIComponent(login)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
    });
    if (!response.ok) {
      throw new Error(`Twitch user lookup failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as {
      data: Array<{
        id: string;
        login: string;
        display_name: string;
        profile_image_url?: string;
        broadcaster_type?: string;
      }>;
    };
    const user = body.data[0];
    if (!user) {
      return null;
    }
    return {
      twitchUserId: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
      broadcasterType: user.broadcaster_type,
    };
  },
});

// ---------------------------------------------------------------------------
// Queue editing
// ---------------------------------------------------------------------------

export const enqueue = mutation({
  args: {
    instanceId: v.id("instances"),
    login: v.string(),
    displayName: v.string(),
    twitchUserId: v.string(),
    profileImageUrl: v.optional(v.string()),
    broadcasterType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"shoutoutQueue">> => {
    await requireMember(ctx, args.instanceId);

    const last = await ctx.db
      .query("shoutoutQueue")
      .withIndex("by_instance_and_sort_order", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .first();

    const now = Date.now();
    const id = await ctx.db.insert("shoutoutQueue", {
      instanceId: args.instanceId,
      login: args.login.trim().toLowerCase().replace(/^@/, ""),
      displayName: args.displayName,
      twitchUserId: args.twitchUserId,
      profileImageUrl: args.profileImageUrl,
      broadcasterType: args.broadcasterType,
      sortOrder: last ? last.sortOrder + 1 : 0,
      attempts: 0,
      nextEligibleAt: now,
      createdAt: now,
    });

    await ensureProcessorScheduled(ctx, args.instanceId, now);
    return id;
  },
});

export const removeEntry = mutation({
  args: { instanceId: v.id("instances"), entryId: v.id("shoutoutQueue") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.instanceId);
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.instanceId !== args.instanceId) {
      throw new Error("Queue entry not found");
    }
    await ctx.db.delete(args.entryId);
  },
});

export const reorderQueue = mutation({
  args: { instanceId: v.id("instances"), entryIds: v.array(v.id("shoutoutQueue")) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.instanceId);

    // Only rows whose position actually changed are written, and an entry
    // removed by someone else mid-drag is skipped rather than failing the whole
    // reorder.
    for (let index = 0; index < args.entryIds.length; index++) {
      const entry = await ctx.db.get(args.entryIds[index]);
      if (!entry || entry.instanceId !== args.instanceId) {
        continue;
      }
      if (entry.sortOrder !== index) {
        await ctx.db.patch(entry._id, { sortOrder: index });
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

async function stateRow(ctx: QueryCtx, instanceId: Id<"instances">) {
  return ctx.db
    .query("shoutoutState")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
}

/**
 * Schedule a processor run at `at`, unless one is already scheduled no later
 * than that. Single-flight: every enqueue would otherwise stack another run,
 * and two runs firing together would send two shoutouts inside the cooldown.
 */
async function ensureProcessorScheduled(ctx: MutationCtx, instanceId: Id<"instances">, at: number): Promise<void> {
  const state = await stateRow(ctx, instanceId);
  if (state?.runScheduledFor !== undefined && state.runScheduledFor <= at) {
    return;
  }
  if (state) {
    await ctx.db.patch(state._id, { runScheduledFor: at });
  } else {
    await ctx.db.insert("shoutoutState", { instanceId, runScheduledFor: at });
  }
  await ctx.scheduler.runAt(at, internal.shoutouts.processQueue, { instanceId });
}

export const queueSnapshot = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("shoutoutQueue")
      .withIndex("by_instance_and_sort_order", (q) => q.eq("instanceId", args.instanceId))
      .take(MAX_QUEUE_READ);
    const state = await stateRow(ctx, args.instanceId);
    return { entries, lastAttemptAt: state?.lastAttemptAt };
  },
});

export const clearScheduledRun = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const state = await stateRow(ctx, args.instanceId);
    if (state) {
      await ctx.db.patch(state._id, { runScheduledFor: undefined });
    }
  },
});

export const scheduleRun = internalMutation({
  args: { instanceId: v.id("instances"), at: v.number() },
  handler: async (ctx, args) => {
    await ensureProcessorScheduled(ctx, args.instanceId, args.at);
  },
});

export const recordAttempt = internalMutation({
  args: {
    instanceId: v.id("instances"),
    entryId: v.id("shoutoutQueue"),
    at: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const state = await stateRow(ctx, args.instanceId);
    if (state) {
      await ctx.db.patch(state._id, { lastAttemptAt: args.at });
    } else {
      await ctx.db.insert("shoutoutState", { instanceId: args.instanceId, lastAttemptAt: args.at });
    }

    const entry = await ctx.db.get(args.entryId);
    if (!entry) {
      // Removed by hand while the attempt was in flight; nothing to record.
      return;
    }

    if (args.error === undefined) {
      await ctx.db.delete(args.entryId);
      return;
    }

    const attempts = entry.attempts + 1;
    await ctx.db.patch(args.entryId, {
      attempts,
      nextEligibleAt: args.at + retryDelayMs(attempts),
      lastError: args.error,
    });
  },
});

/**
 * Sends at most one shoutout, then schedules its own next run.
 *
 * One entry per run rather than draining in a loop: the cooldown between sends
 * is minutes, and a Convex action holding a timer open that long is neither
 * reliable nor cheap. The scheduler is the timer.
 */
export const processQueue = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<void> => {
    await ctx.runMutation(internal.shoutouts.clearScheduledRun, { instanceId: args.instanceId });

    // Annotated because this calls a query in its own file: without it the
    // inferred type is circular and TypeScript gives up.
    const { entries, lastAttemptAt }: { entries: Doc<"shoutoutQueue">[]; lastAttemptAt?: number } = await ctx.runQuery(
      internal.shoutouts.queueSnapshot,
      { instanceId: args.instanceId }
    );
    if (entries.length === 0) {
      return;
    }

    const now = Date.now();
    const sendAt = nextSendAt(lastAttemptAt, now);
    if (sendAt > now) {
      await ctx.runMutation(internal.shoutouts.scheduleRun, { instanceId: args.instanceId, at: sendAt });
      return;
    }

    const entry = pickNextEntry(entries, now);
    if (!entry) {
      const waitUntil = earliestEligibleAt(entries);
      if (waitUntil !== null) {
        await ctx.runMutation(internal.shoutouts.scheduleRun, { instanceId: args.instanceId, at: waitUntil });
      }
      return;
    }

    let error: string | undefined;
    try {
      await sendShoutoutNow(ctx, args.instanceId, entry.twitchUserId);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await ctx.runMutation(internal.shoutouts.recordAttempt, {
      instanceId: args.instanceId,
      entryId: entry._id,
      at: now,
      error,
    });

    // Something is always left to do after an attempt: either more entries, or
    // this one waiting on its backoff. Asking for the cooldown from now is the
    // floor; the next run re-reads the queue and waits longer if it must.
    await ctx.runMutation(internal.shoutouts.scheduleRun, {
      instanceId: args.instanceId,
      at: now + SHOUTOUT_COOLDOWN_MS,
    });
  },
});

async function sendShoutoutNow(ctx: ActionCtx, instanceId: Id<"instances">, toBroadcasterId: string): Promise<void> {
  const { accessToken, broadcasterUserId, clientId } = await authorizeTwitchUnattended(ctx, instanceId, SHOUTOUT_SCOPE);

  const url = `${TWITCH_SHOUTOUTS_URL}?from_broadcaster_id=${broadcasterUserId}&to_broadcaster_id=${toBroadcasterId}&moderator_id=${broadcasterUserId}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId },
  });

  if (response.status === 429) {
    throw new Error("Twitch is rate-limiting shoutouts");
  }
  if (!response.ok) {
    // The common case is the target being offline, which Twitch refuses. The
    // body says which, and it lands on the entry as lastError.
    throw new Error(`Twitch shoutout failed: ${response.status} ${await response.text()}`);
  }
}
