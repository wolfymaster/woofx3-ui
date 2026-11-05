import { type ObjectType, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query } from "./_generated/server";
import { claimPendingStreamStartMarker } from "./lib/goLiveMarker";
import { isInstanceMember } from "./lib/teamAccess";

export const getForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    // The shell subscribes with the instance id cached from the last session
    // before membership is confirmed, so an id the caller has lost access to
    // must read as nothing.
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    return ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
  },
});

/**
 * How long after a stream goes offline its session is snapshotted. The engine
 * closes the session's live segment from the same bus event that produces the
 * offline callback, with no ordering between the two, so the snapshot waits
 * long enough to read the segment closed.
 */
const OFFLINE_SNAPSHOT_DELAY_MS = 15_000;

/**
 * Called only on a live-to-offline transition, so a redelivered offline
 * callback, or a poll confirming a stream already recorded as offline, does not
 * schedule another snapshot.
 */
async function scheduleOfflineSnapshot(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  await ctx.scheduler.runAfter(OFFLINE_SNAPSHOT_DELAY_MS, internal.streamRecap.snapshotAfterStreamOffline, {
    instanceId,
  });
}

const onStreamOnlineArgs = {
  instanceId: v.id("instances"),
  twitchUserId: v.string(),
  startedAt: v.string(),
  streamTitle: v.optional(v.string()),
  gameName: v.optional(v.string()),
  viewerCount: v.optional(v.number()),
};

export async function applyStreamOnline(
  ctx: MutationCtx,
  { instanceId, twitchUserId, startedAt, streamTitle, gameName, viewerCount }: ObjectType<typeof onStreamOnlineArgs>
) {
  const existing = await ctx.db
    .query("instanceLiveState")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();

  const patch = {
    instanceId,
    twitchUserId,
    isLive: true,
    startedAt,
    streamTitle,
    gameName,
    viewerCount,
    lastUpdateSource: "webhook" as const,
    lastUpdatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("instanceLiveState", patch);
  }
  if (!existing?.isLive) {
    await claimPendingStreamStartMarker(ctx, instanceId, patch.lastUpdatedAt);
  }
}

export const onStreamOnline = internalMutation({ args: onStreamOnlineArgs, handler: applyStreamOnline });

type PolledFields = Pick<
  Doc<"instanceLiveState">,
  "twitchUserId" | "isLive" | "startedAt" | "streamTitle" | "gameName" | "viewerCount"
>;

function pollMatches(existing: PolledFields, polled: PolledFields): boolean {
  return (
    existing.isLive === polled.isLive &&
    existing.twitchUserId === polled.twitchUserId &&
    existing.startedAt === polled.startedAt &&
    existing.streamTitle === polled.streamTitle &&
    existing.gameName === polled.gameName &&
    existing.viewerCount === polled.viewerCount
  );
}

// Reconciles instanceLiveState from a live engine poll (see streamStatus.ts).
// Exists because the STREAM_ONLINE/OFFLINE webhook path can silently stop
// delivering (EventSub subscription lapses, the engine's twitch listener
// restarts, etc.) and leave this table stuck on a stale event indefinitely.
export const recordPoll = internalMutation({
  args: {
    instanceId: v.id("instances"),
    isLive: v.boolean(),
    twitchUserId: v.optional(v.string()),
    startedAt: v.optional(v.string()),
    streamTitle: v.optional(v.string()),
    gameName: v.optional(v.string()),
    viewerCount: v.optional(v.number()),
  },
  handler: async (ctx, { instanceId, isLive, twitchUserId, startedAt, streamTitle, gameName, viewerCount }) => {
    const existing = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();

    const patch = {
      instanceId,
      twitchUserId,
      isLive,
      startedAt: isLive ? startedAt : undefined,
      streamTitle: isLive ? streamTitle : undefined,
      gameName: isLive ? gameName : undefined,
      viewerCount: isLive ? viewerCount : undefined,
      lastUpdateSource: "poll" as const,
      lastUpdatedAt: Date.now(),
    };

    // A poll that confirms what the row already says writes nothing. Every
    // write re-runs each dashboard's subscription to this row, and a
    // confirmation changes nothing anyone sees.
    if (existing && pollMatches(existing, patch)) {
      return;
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("instanceLiveState", patch);
    }
    if (isLive && !existing?.isLive) {
      await claimPendingStreamStartMarker(ctx, instanceId, patch.lastUpdatedAt);
    }
    if (!isLive && existing?.isLive) {
      await scheduleOfflineSnapshot(ctx, instanceId);
    }
  },
});

const onSessionStartedArgs = {
  instanceId: v.id("instances"),
  sessionId: v.string(),
  sessionStartedAt: v.string(),
};

// The engine's resolver owns which session the system is in and announces it
// here. Deliberately not folded into onStreamOnline: a session spans brief
// dropouts, so it changes on a different schedule from the broadcast, and on
// the engine side the two are separate bus subscribers with no ordering
// between them.
//
// Touches only the session fields. isLive and the broadcast columns belong to
// the stream writers, and a session can legitimately start while offline.
export async function applySessionStarted(
  ctx: MutationCtx,
  { instanceId, sessionId, sessionStartedAt }: ObjectType<typeof onSessionStartedArgs>
) {
  const existing = await ctx.db
    .query("instanceLiveState")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { sessionId, sessionStartedAt });
    return;
  }

  // No stream event has landed yet, so nothing knows whether we are live.
  await ctx.db.insert("instanceLiveState", {
    instanceId,
    sessionId,
    sessionStartedAt,
    isLive: false,
    lastUpdateSource: "webhook" as const,
    lastUpdatedAt: Date.now(),
  });
}

export const onSessionStarted = internalMutation({ args: onSessionStartedArgs, handler: applySessionStarted });

const onStreamOfflineArgs = {
  instanceId: v.id("instances"),
  twitchUserId: v.string(),
};

export async function applyStreamOffline(
  ctx: MutationCtx,
  { instanceId, twitchUserId }: ObjectType<typeof onStreamOfflineArgs>
) {
  const existing = await ctx.db
    .query("instanceLiveState")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();

  const patch = {
    instanceId,
    twitchUserId,
    isLive: false,
    startedAt: undefined,
    streamTitle: undefined,
    gameName: undefined,
    viewerCount: undefined,
    lastUpdateSource: "webhook" as const,
    lastUpdatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("instanceLiveState", patch);
  }
  if (existing?.isLive) {
    await scheduleOfflineSnapshot(ctx, instanceId);
  }
}

export const onStreamOffline = internalMutation({ args: onStreamOfflineArgs, handler: applyStreamOffline });
