import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

// Polls one instance's engine for its live, Helix-backed getStreamStatus and
// reconciles instanceLiveState with the result. instanceLiveState is normally
// kept fresh by STREAM_ONLINE/STREAM_OFFLINE webhook pushes (real-time, no
// polling), but that path can silently stop delivering (EventSub subscription
// lapses, the engine's twitch listener restarts) and leave it stuck on a
// stale event indefinitely. This is the self-heal for that — called directly
// by the UI (see pollLiveState below) and on a schedule by sweepLiveState so
// it self-heals even with no browser tab open.
export const syncInstanceLiveState = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<boolean> => {
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId: args.instanceId });
    if (!instance?.clientId || !instance?.clientSecret) {
      return false;
    }

    try {
      const rpc = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
      const status = await rpc.getStreamStatus(args.instanceId);
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

// Cron entry point (see crons.ts) — sweeps every engine-registered instance
// so a stale instanceLiveState row self-heals without anyone having the
// dashboard open. Best-effort per instance; one failure doesn't block others.
export const sweepLiveState = internalAction({
  args: {},
  handler: async (ctx) => {
    const instanceIds = await ctx.runQuery(internal.instances.listRegisteredIds, {});
    for (const instanceId of instanceIds) {
      await ctx.runAction(internal.streamStatus.syncInstanceLiveState, { instanceId });
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
