import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalQuery, query } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import {
  attributedSupporters,
  engineFailureMessage,
  isValidMinTotal,
  LEADERBOARD_LIMIT,
  NO_SUPPORT,
  recentLiveStreams,
  STREAM_PICKER_LIMIT,
  SUPPORTER_PLATFORM,
  type Supporter,
  type SupporterEngineMethods,
  type SupporterStream,
  type SupporterTotals,
  toSupporterStream,
  toSupporterTotals,
  VIEWER_RECENT_STREAMS,
  VIEWER_STREAM_SCAN,
  type ViewerStreamTotals,
} from "./lib/supporters";
import { getInstanceMembership, isInstanceMember } from "./lib/teamAccess";
import { fetchTwitchAppCredentials, fetchTwitchUser, normalizeTwitchLogin, type TwitchUser } from "./lib/twitchUsers";
import { SHOUTOUT_SCOPE } from "./shoutouts";

// Every function here reads per-viewer figures from the engine and hands them
// straight back. None of them writes: see convex/lib/supporters.ts for why
// per-viewer detail never lands in a Convex table.

interface SupporterEngineApi extends EngineApi, SupporterEngineMethods {}

interface EngineCredentials {
  url: string;
  clientId: string;
  clientSecret: string;
}

type InstanceAccess =
  | { status: "not-member" }
  | { status: "unregistered" }
  | { status: "ready"; engine: EngineCredentials };

/** Whether the user may use this instance, and the engine credentials to do it with. */
export const instanceAccessFor = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }): Promise<InstanceAccess> => {
    if (!(await getInstanceMembership(ctx, instanceId, userId))) {
      return { status: "not-member" };
    }
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return { status: "not-member" };
    }
    if (!instance.clientId || !instance.clientSecret) {
      return { status: "unregistered" };
    }
    return {
      status: "ready",
      engine: { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret },
    };
  },
});

/**
 * The caller's access to the instance, refusing anyone signed out or not a
 * member. Messages are ConvexErrors because production masks a plain Error as
 * "Server Error".
 */
async function requireAccess(ctx: ActionCtx, instanceId: Id<"instances">): Promise<InstanceAccess> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Sign in to see your supporters.");
  }
  // Annotated because this calls a query in its own file: without it the
  // inferred type is circular and TypeScript gives up.
  const access: InstanceAccess = await ctx.runQuery(internal.supporters.instanceAccessFor, { instanceId, userId });
  if (access.status === "not-member") {
    throw new ConvexError("You are not a member of this instance.");
  }
  return access;
}

async function requireEngine(ctx: ActionCtx, instanceId: Id<"instances">): Promise<EngineCredentials> {
  const access = await requireAccess(ctx, instanceId);
  if (access.status !== "ready") {
    throw new ConvexError("This instance is not connected to its engine yet.");
  }
  return access.engine;
}

/**
 * Engine calls on one capnweb HTTP batch session. The batch is sent on the
 * first await, so `calls` must issue every call it wants in the batch before
 * awaiting any of them; a session is spent once sent.
 */
async function callEngine<T>(
  engine: EngineCredentials,
  what: string,
  calls: (rpc: SupporterEngineApi) => Promise<T>
): Promise<T> {
  const rpc = createEngineRpcSession<SupporterEngineApi>(engine.url, engine.clientId, engine.clientSecret);
  try {
    return await calls(rpc);
  } catch (err) {
    throw new ConvexError(engineFailureMessage(what, err));
  }
}

/** Recent streams for the range picker, newest first. */
export const listStreams = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<SupporterStream[]> => {
    const engine = await requireEngine(ctx, instanceId);
    const page = await callEngine(engine, "your streams", (rpc) =>
      rpc.listStreamSessions({ limit: STREAM_PICKER_LIMIT })
    );
    return page.sessions.map(toSupporterStream);
  },
});

/**
 * Top supporters by bits or gifted subs, for one stream or, with no
 * `sessionId`, for all time. Anonymous cheers and gifts rank nobody.
 */
export const leaderboard = action({
  args: {
    instanceId: v.id("instances"),
    metric: v.union(v.literal("bits"), v.literal("giftedSubs")),
    sessionId: v.optional(v.string()),
    minTotal: v.number(),
  },
  handler: async (ctx, { instanceId, metric, sessionId, minTotal }): Promise<Supporter[]> => {
    if (!isValidMinTotal(minTotal)) {
      throw new ConvexError("The minimum must be a whole number of at least 1.");
    }
    const engine = await requireEngine(ctx, instanceId);
    const board = await callEngine(engine, "the leaderboard", (rpc) =>
      rpc.getLeaderboard({
        metric,
        minTotal,
        limit: LEADERBOARD_LIMIT,
        ...(sessionId !== undefined ? { sessionId } : {}),
      })
    );
    if (board === null) {
      // Splits and merges can retire a session id the picker still holds.
      throw new ConvexError("That stream no longer exists. Pick it again from the list.");
    }
    return attributedSupporters(board.entries);
  },
});

/**
 * One viewer's lifetime totals and their totals for each of the last few live
 * streams, in two engine round trips: lifetime and the stream list together,
 * then every per-stream read together. A stream the engine no longer has
 * (merged away between the two) is left out rather than shown as zero.
 */
export const viewerTotals = action({
  args: { instanceId: v.id("instances"), platformUserId: v.string() },
  handler: async (
    ctx,
    { instanceId, platformUserId }
  ): Promise<{ userName: string | null; lifetime: SupporterTotals; recent: ViewerStreamTotals[] }> => {
    if (platformUserId.trim() === "") {
      throw new ConvexError("Pick a viewer to look up.");
    }
    const engine = await requireEngine(ctx, instanceId);
    const viewer = { platform: SUPPORTER_PLATFORM, platformUserId };

    const [lifetime, page] = await callEngine(engine, "this viewer's totals", (rpc) => {
      const lifetimeCall = rpc.getViewerTotals(viewer);
      const streamsCall = rpc.listStreamSessions({ limit: VIEWER_STREAM_SCAN });
      return Promise.all([lifetimeCall, streamsCall]);
    });

    const recentStreams = recentLiveStreams(page.sessions.map(toSupporterStream), VIEWER_RECENT_STREAMS);
    const perStream =
      recentStreams.length === 0
        ? []
        : await callEngine(engine, "this viewer's stream totals", (rpc) => {
            const calls = recentStreams.map((stream) => rpc.getViewerTotals({ ...viewer, sessionId: stream.id }));
            return Promise.all(calls);
          });

    const recent: ViewerStreamTotals[] = [];
    recentStreams.forEach((stream, index) => {
      const totals = perStream[index];
      if (totals !== null && totals !== undefined) {
        recent.push({ stream, totals: toSupporterTotals(totals) });
      }
    });

    return {
      userName: lifetime?.userName ?? null,
      lifetime: lifetime === null ? NO_SUPPORT : toSupporterTotals(lifetime),
      recent,
    };
  },
});

/**
 * A viewer's Twitch identity by login (a name typed into the search) or by id
 * (a leaderboard row, whose engine record carries a display name, not a
 * login). Null when Twitch has nobody by that name or id. Uses an app token:
 * `/helix/users` needs no scope, so the lookup works whatever the channel's
 * Twitch link was granted.
 */
export const findTwitchViewer = action({
  args: {
    instanceId: v.id("instances"),
    by: v.union(v.object({ login: v.string() }), v.object({ twitchUserId: v.string() })),
  },
  handler: async (ctx, { instanceId, by }): Promise<TwitchUser | null> => {
    await requireAccess(ctx, instanceId);

    let lookup: { login: string } | { id: string };
    if ("login" in by) {
      const login = normalizeTwitchLogin(by.login);
      if (!login) {
        return null;
      }
      lookup = { login };
    } else {
      lookup = { id: by.twitchUserId };
    }

    try {
      return await fetchTwitchUser(await fetchTwitchAppCredentials(), lookup);
    } catch (err) {
      throw new ConvexError(err instanceof Error ? err.message : String(err));
    }
  },
});

/**
 * Whether the channel's Twitch link can send shoutouts, so the page can say
 * "reconnect Twitch" at the button instead of the queue failing later. Only
 * the yes/no leaves the backend: the link row also holds its tokens.
 */
export const canShoutOut = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<boolean> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return false;
    }
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();
    return link?.scopes.includes(SHOUTOUT_SCOPE) ?? false;
  },
});
