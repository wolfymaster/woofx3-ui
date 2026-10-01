import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

// Polls one instance's engine for its live, Helix-backed getStreamStatus and
// reconciles instanceLiveState with the result. instanceLiveState is normally
// kept fresh by STREAM_ONLINE/STREAM_OFFLINE webhook pushes (real-time, no
// polling), but that path can silently stop delivering (EventSub subscription
// lapses, the engine's twitch listener restarts) and leave it stuck on a
// stale event indefinitely. This is the self-heal for that — called directly
// by the UI (see pollLiveState below) and on a schedule by sweepLiveState for
// instances that believe they are live.
export const syncInstanceLiveState = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<boolean> => {
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId: args.instanceId });
    if (!instance?.clientId || !instance?.clientSecret) {
      return false;
    }

    try {
      const rpc = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
      const status = await rpc.getStreamStatus();
      await ctx.runMutation(internal.instanceLiveState.recordPoll, {
        instanceId: args.instanceId,
        isLive: status.isLive,
        twitchUserId: status.twitchUserId,
        startedAt: status.startedAt,
        streamTitle: status.streamTitle,
        gameName: status.gameName,
        viewerCount: status.viewerCount,
      });
      return true;
    } catch {
      return false;
    }
  },
});

// Bounds one sweep's fan-out, well inside a mutation's scheduling limit. The
// read is always the same first rows of the index, so a fleet with more
// instances live at once than this needs a cursor here.
const LIVE_SWEEP_BATCH = 500;

// Cron entry point (see crons.ts). Re-polls only instances recorded as live, so
// an idle fleet costs this one mutation per tick however many instances exist.
// The failure it catches is a missed STREAM_OFFLINE, which would otherwise
// leave an instance showing live forever. A missed STREAM_ONLINE is left to
// pollLiveState, which runs when someone opens the dashboard: an instance
// nobody is looking at gains nothing from knowing it is live.
export const sweepLiveState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const live = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_is_live", (q) => q.eq("isLive", true))
      .take(LIVE_SWEEP_BATCH);
    for (const row of live) {
      await ctx.scheduler.runAfter(0, internal.streamStatus.syncInstanceLiveState, { instanceId: row.instanceId });
    }
  },
});

// User-facing entry point — the UI calls this on load for immediate
// freshness, on top of the cron sweep's ongoing background reconciliation.
export const pollLiveState = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false };
    }

    const bundle: { url: string; clientId: string | null; clientSecret: string | null } | null = await ctx.runQuery(
      internal.workflowCatalogContext.catalogContextForUser,
      {
        instanceId: args.instanceId,
        userId,
      }
    );
    if (!bundle) {
      return { ok: false };
    }

    const ok = await ctx.runAction(internal.streamStatus.syncInstanceLiveState, { instanceId: args.instanceId });
    return { ok };
  },
});
