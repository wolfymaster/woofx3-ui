import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import {
  type ClipWindow,
  clipWindow,
  type HelixClip,
  RECAP_CLIP_LIMIT,
  RECAP_CLIP_MAX_PAGES,
  type RecapClip,
  sortClipsByViews,
  toRecapClip,
} from "./lib/recapClips";
import { sessionSnapshotPayload } from "./lib/sessionSummary";
import {
  classifyEngineCallError,
  type EngineCallFailure,
  RECAP_LEADERBOARD_LIMIT,
  type StreamRecapEngineApi,
  type StreamRecapEngineDetail,
  toRecapEngineDetail,
} from "./lib/streamRecap";
import { logger } from "./logger";

/**
 * The parts of a stream recap only the engine holds: per-minute viewer samples
 * and who cheered or gifted the most. Totals come from the stored summary
 * instead, so the page renders them even when this call cannot reach the engine.
 */
export const loadEngineDetail = action({
  args: {
    instanceId: v.id("instances"),
    sessionId: v.string(),
  },
  handler: async (ctx, { instanceId, sessionId }): Promise<StreamRecapEngineDetail> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
    if (!membership) {
      throw new Error("Not authorized");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      return { status: "unregistered" };
    }
    const { url, clientId, clientSecret } = instance;

    // A capnweb HTTP batch session sends its batch on the first await and is
    // spent after that, so each RPC gets its own session; they still run
    // concurrently.
    const session = () => createEngineRpcSession<StreamRecapEngineApi>(url, clientId, clientSecret);
    try {
      const [gauges, cheerers, gifters] = await Promise.all([
        session().getStreamSessionGauges(sessionId),
        session().getLeaderboard({ metric: "bits", sessionId, limit: RECAP_LEADERBOARD_LIMIT }),
        session().getLeaderboard({ metric: "giftedSubs", sessionId, limit: RECAP_LEADERBOARD_LIMIT }),
      ]);
      return toRecapEngineDetail(gauges, cheerers, gifters);
    } catch (error) {
      const failure = classifyEngineCallError(error);
      logger.warn("stream recap: engine call failed", {
        instanceId,
        sessionId,
        status: failure.status,
        error: error instanceof Error ? error.message : String(error),
      });
      return failure;
    }
  },
});

/**
 * How old a stored snapshot of the open session may be before another is
 * taken. Every open recap page, list and Recent Streams widget asks, so this
 * keeps a room full of viewers to about one engine read per window.
 */
const OPEN_SNAPSHOT_MAX_AGE_MS = 30_000;

export type OpenSessionRefresh =
  | { status: "stored" }
  | { status: "fresh" }
  | { status: "no_open_session" }
  | { status: "unregistered" }
  | EngineCallFailure;

/**
 * Takes a snapshot of the engine's open session and stores it as that
 * session's summary. The engine's own summary, sent when the session ends, and
 * every later snapshot replace it.
 */
async function snapshotOpenSession(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  reason: string
): Promise<OpenSessionRefresh> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance?.clientId || !instance.clientSecret) {
    return { status: "unregistered" };
  }
  const { url, clientId, clientSecret } = instance;
  const session = () => createEngineRpcSession<EngineApi>(url, clientId, clientSecret);

  try {
    // At most one session is open, and it is always the newest.
    const page = await session().listStreamSessions({ limit: 1 });
    const open = page.sessions[0];
    if (!open || open.status !== "open") {
      return { status: "no_open_session" };
    }
    const totals = await session().getStreamSessionTotals(open.id);
    if (totals === null) {
      return { status: "no_open_session" };
    }
    await ctx.runMutation(internal.streamSessionSummaries.upsertOpenSnapshot, {
      instanceId,
      data: sessionSnapshotPayload(open, totals, new Date()),
    });
    return { status: "stored" };
  } catch (error) {
    const failure = classifyEngineCallError(error);
    logger.warn("stream recap: snapshot of the open session failed", {
      instanceId,
      reason,
      status: failure.status,
      error: error instanceof Error ? error.message : String(error),
    });
    return failure;
  }
}

/**
 * Snapshots the open session for a page showing recaps, so a stream in
 * progress shows in the recaps before the engine summarises it.
 */
export const refreshOpenSession = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<OpenSessionRefresh> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
    if (!membership) {
      throw new Error("Not authorized");
    }
    const newest = await ctx.runQuery(internal.streamSessionSummaries.newestInternal, { instanceId });
    if (newest?.session?.status === "open" && Date.now() - newest.receivedAt < OPEN_SNAPSHOT_MAX_AGE_MS) {
      return { status: "fresh" };
    }
    return snapshotOpenSession(ctx, instanceId, "page");
  },
});

/**
 * Snapshots the open session once its stream has gone offline. The engine
 * keeps the session open until the next broadcast decides whether to continue
 * it, so without this the stored row would keep the figures and still-live
 * segment of the last snapshot taken while live, or none at all if nobody had
 * a recap open. Scheduled by instanceLiveState on the live-to-offline
 * transition; skips the freshness check because a snapshot taken moments
 * before the stream went down is exactly the one this replaces.
 */
export const snapshotAfterStreamOffline = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<OpenSessionRefresh> => {
    return snapshotOpenSession(ctx, instanceId, "stream_offline");
  },
});

const TWITCH_CLIPS_URL = "https://api.twitch.tv/helix/clips";

export type RecapClipsResult = { status: "ok"; clips: RecapClip[] } | { status: "never_live" };

interface HelixClipsPage {
  data: HelixClip[];
  pagination?: { cursor?: string };
}

async function fetchClipsInWindow(
  credentials: { accessToken: string; clientId: string },
  broadcasterUserId: string,
  window: ClipWindow
): Promise<HelixClip[]> {
  const clips: HelixClip[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < RECAP_CLIP_MAX_PAGES && clips.length < RECAP_CLIP_LIMIT; page++) {
    const params = new URLSearchParams({
      broadcaster_id: broadcasterUserId,
      started_at: new Date(window.startedAtMs).toISOString(),
      ended_at: new Date(window.endedAtMs).toISOString(),
      first: String(RECAP_CLIP_LIMIT - clips.length),
    });
    if (cursor) {
      params.set("after", cursor);
    }
    const response = await fetch(`${TWITCH_CLIPS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Client-Id": credentials.clientId },
    });
    if (response.status === 401) {
      throw new ConvexError("Twitch rejected this channel's connection. Reconnect Twitch in Settings, Integrations.");
    }
    if (response.status === 429) {
      throw new ConvexError("Twitch is rate-limiting requests right now. Try again in a minute.");
    }
    if (!response.ok) {
      throw new ConvexError(`Twitch couldn't list clips (${response.status}).`);
    }
    const body = (await response.json()) as HelixClipsPage;
    if (!Array.isArray(body?.data)) {
      throw new ConvexError("Twitch answered the clip list in an unexpected shape.");
    }
    clips.push(...body.data);
    cursor = body.pagination?.cursor;
    if (!cursor || body.data.length === 0) {
      break;
    }
  }
  return clips.slice(0, RECAP_CLIP_LIMIT);
}

/**
 * The Twitch clips made while a recapped session was live, most viewed first.
 * Fetched from Helix on every call and never stored: view counts keep moving
 * after the stream, and a clip deleted on Twitch should vanish from the recap.
 * Listing clips needs no scope, so the broadcaster's link token serves as is.
 */
export const loadClips = action({
  args: {
    instanceId: v.id("instances"),
    sessionId: v.string(),
  },
  handler: async (ctx, { instanceId, sessionId }): Promise<RecapClipsResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Not authenticated");
    }
    const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
    if (!membership) {
      throw new ConvexError("Not authorized");
    }
    const row = await ctx.runQuery(internal.streamSessionSummaries.getInternal, { instanceId, sessionId });
    if (!row) {
      throw new ConvexError("There's no recap for this stream.");
    }
    const window = clipWindow(row.session?.segments ?? [], Date.now());
    if (window === null) {
      return { status: "never_live" };
    }

    const clientId = process.env.AUTH_TWITCH_ID;
    if (!clientId) {
      throw new ConvexError("Twitch isn't configured for this dashboard (AUTH_TWITCH_ID is not set).");
    }
    let token: { accessToken: string; broadcasterUserId: string } | null;
    try {
      token = await ctx.runAction(internal.platformRealtime.ensureFreshTwitchToken, { instanceId });
    } catch (error) {
      logger.warn("stream recap: twitch token refresh failed", {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ConvexError("Couldn't refresh the Twitch connection. Reconnect Twitch in Settings, Integrations.");
    }
    if (!token) {
      throw new ConvexError("Twitch isn't connected for this instance. Connect it in Settings, Integrations.");
    }

    const clips = await fetchClipsInWindow(
      { accessToken: token.accessToken, clientId },
      token.broadcasterUserId,
      window
    );
    return { status: "ok", clips: sortClipsByViews(clips.map((clip) => toRecapClip(clip, window))) };
  },
});
