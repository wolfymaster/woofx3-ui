import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import {
  type AdScheduleResult,
  type AdSnoozeResult,
  ENGINE_TOO_OLD_FOR_ADS,
  parseAdSchedule,
  parseAdSnoozeResult,
} from "./lib/adBreaks";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { isMissingEngineMethodError } from "./lib/engineMethodSupport";

/** The ad-break methods are not on the shared EngineApi the UI builds against yet. */
interface AdBreakEngineApi extends EngineApi {
  getAdSchedule(): Promise<unknown>;
  snoozeNextAd(): Promise<unknown>;
}

// Both calls go through the engine, which holds the broadcaster's token and
// talks to Helix; the UI never calls Twitch's ads endpoints itself.
//
// Any member may snooze, not only owners and admins. A snooze only pushes the
// next ad back (Twitch refills them over time), it is the kind of call a
// moderator running the stream makes on the spot, and a streamer mid-moment
// cannot stop to find an admin. Every failure leaves as a ConvexError so its
// sentence survives production's masking of plain errors.

async function engineSession(ctx: ActionCtx, instanceId: Id<"instances">): Promise<AdBreakEngineApi | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Sign in again to see ad breaks.");
  }
  const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
  if (!membership) {
    throw new ConvexError("You do not have access to this instance.");
  }
  const bundle = await ctx.runQuery(internal.engineSyncInternal.getInstanceBundle, { instanceId });
  if (!bundle) {
    return null;
  }
  return createEngineRpcSession<AdBreakEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const getSchedule = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<AdScheduleResult> => {
    const engine = await engineSession(ctx, args.instanceId);
    if (!engine) {
      return { state: "unregistered" };
    }
    let raw: unknown;
    try {
      raw = await engine.getAdSchedule();
    } catch (err) {
      const message = messageOf(err);
      if (isMissingEngineMethodError(message, "getAdSchedule")) {
        return { state: "engineOutdated" };
      }
      throw new ConvexError(`Could not read the ad schedule: ${message}`);
    }
    const schedule = parseAdSchedule(raw);
    if (!schedule) {
      throw new ConvexError("The engine answered with an ad schedule this page cannot read.");
    }
    return { state: "ok", schedule };
  },
});

export const snoozeNextAd = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<AdSnoozeResult> => {
    const engine = await engineSession(ctx, args.instanceId);
    if (!engine) {
      throw new ConvexError("This instance is not registered with an engine.");
    }
    let raw: unknown;
    try {
      raw = await engine.snoozeNextAd();
    } catch (err) {
      const message = messageOf(err);
      if (isMissingEngineMethodError(message, "snoozeNextAd")) {
        throw new ConvexError(ENGINE_TOO_OLD_FOR_ADS);
      }
      throw new ConvexError(`Could not snooze the next ad: ${message}`);
    }
    const result = parseAdSnoozeResult(raw);
    if (!result) {
      throw new ConvexError("The engine snoozed the ad but answered with something this page cannot read.");
    }
    return result;
  },
});
