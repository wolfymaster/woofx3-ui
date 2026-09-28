import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import {
  attributedSupporters,
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
  type ViewerStreamTotals,
} from "./lib/supporters";
import { authorizeTwitch } from "./lib/twitchAuth";
import { fetchTwitchUser, normalizeTwitchLogin, type TwitchUser } from "./lib/twitchUsers";

// Every function here reads per-viewer figures from the engine and hands them
// straight back. None of them writes: see convex/lib/supporters.ts for why
// per-viewer detail never lands in a Convex table.

interface SupporterEngineApi extends EngineApi, SupporterEngineMethods {}

interface EngineCredentials {
  url: string;
  clientId: string;
  clientSecret: string;
}

/** Messages are ConvexErrors because production masks a plain Error as "Server Error". */
async function requireEngine(ctx: ActionCtx, instanceId: Id<"instances">): Promise<EngineCredentials> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Sign in to see your supporters.");
  }
  const bundle: { url: string; clientId: string | null; clientSecret: string | null } | null = await ctx.runQuery(
    internal.workflowCatalogContext.catalogContextForUser,
    { instanceId, userId }
  );
  if (!bundle) {
    throw new ConvexError("You are not a member of this instance.");
  }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new ConvexError("This instance is not connected to its engine yet.");
  }
  return { url: bundle.url, clientId: bundle.clientId, clientSecret: bundle.clientSecret };
}

/**
 * One engine call on its own capnweb session: an HTTP batch session is spent
 * by its first await, so independent calls each need a fresh one.
 */
async function callEngine<T>(
  engine: EngineCredentials,
  what: string,
  call: (rpc: SupporterEngineApi) => Promise<T>
): Promise<T> {
  const rpc = createEngineRpcSession<SupporterEngineApi>(engine.url, engine.clientId, engine.clientSecret);
  try {
    return await call(rpc);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConvexError(`Could not load ${what} from your engine: ${reason}`);
  }
}

async function readStreams(engine: EngineCredentials): Promise<SupporterStream[]> {
  const page = await callEngine(engine, "your streams", (rpc) =>
    rpc.listStreamSessions({ limit: STREAM_PICKER_LIMIT })
  );
  return page.sessions.map(toSupporterStream);
}

/** Recent streams for the range picker, newest first. */
export const listStreams = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<SupporterStream[]> => {
    const engine = await requireEngine(ctx, instanceId);
    return readStreams(engine);
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
 * streams. A stream the engine no longer has (merged away between the two
 * reads) is left out rather than shown as zero.
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

    const [lifetime, streams] = await Promise.all([
      callEngine(engine, "this viewer's totals", (rpc) => rpc.getViewerTotals(viewer)),
      readStreams(engine),
    ]);

    const recentStreams = recentLiveStreams(streams, VIEWER_RECENT_STREAMS);
    const perStream = await Promise.all(
      recentStreams.map((stream) =>
        callEngine(engine, "this viewer's stream totals", (rpc) =>
          rpc.getViewerTotals({ ...viewer, sessionId: stream.id })
        )
      )
    );

    const recent: ViewerStreamTotals[] = [];
    recentStreams.forEach((stream, index) => {
      const totals = perStream[index];
      if (totals !== null) {
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

// The Twitch lookup exists so the page can shout a supporter out, so it asks
// for the shoutout scope: a link without it finds that out here, where the
// page can say so, instead of when the shoutout queue tries to send.
const SHOUTOUT_SCOPE = "moderator:manage:shoutouts";

/**
 * A viewer's Twitch identity by login (a name typed into the search) or by id
 * (a leaderboard row, whose engine record carries a display name, not a
 * login). Null when Twitch has nobody by that name or id.
 */
export const findTwitchViewer = action({
  args: {
    instanceId: v.id("instances"),
    by: v.union(v.object({ login: v.string() }), v.object({ twitchUserId: v.string() })),
  },
  handler: async (ctx, { instanceId, by }): Promise<TwitchUser | null> => {
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
      const { accessToken, clientId } = await authorizeTwitch(ctx, instanceId, SHOUTOUT_SCOPE);
      return await fetchTwitchUser({ accessToken, clientId }, lookup);
    } catch (err) {
      throw new ConvexError(err instanceof Error ? err.message : String(err));
    }
  },
});
