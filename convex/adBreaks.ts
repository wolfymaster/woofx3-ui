import {
  AD_MANAGE_SCOPE,
  AD_READ_SCOPE,
  AD_SCHEDULE_UNREADABLE_MESSAGE,
  AD_SCOPE_MISSING_MESSAGE,
  AD_SNOOZE_UNREADABLE_MESSAGE,
  type AdHelixOperation,
  type AdSchedule,
  type AdSnoozeResult,
  adHelixErrorMessage,
  parseHelixAdSchedule,
  parseHelixSnoozeResult,
  readAdAnswer,
} from "@shared/ad-breaks";
import { missingTwitchScopeMessage } from "@shared/twitch-link-refusal";
import type { TwitchHelixResult } from "@woofx3/api";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import type { EngineApi } from "./lib/engineInstanceUrl";
import { type AuthorizedTwitchCall, authorizeTwitch } from "./lib/twitchAuth";
import { helixResponse, type TwitchHelixRoute, twitchHelixRoute } from "./lib/twitchEngineHelix";

// The Ad breaks dashboard widget's schedule and snooze, straight to Helix like
// convex/pins.ts, or through an engine that advertises twitch.ads and makes
// the same calls (convex/lib/twitchEngineHelix.ts). Convex holds a refreshable
// broadcaster token either way. The engine's other part is the ad-break
// events, which reach the widget over the stream-event session.
//
// Any member may snooze, not only owners and admins. A snooze only pushes the
// next ad back (Twitch refills them over time), it is the kind of call a
// moderator running the stream makes on the spot, and a streamer mid-moment
// cannot stop to find an admin. Every failure leaves as a ConvexError so its
// sentence survives production's masking of plain errors.

const TWITCH_ADS_URL = "https://api.twitch.tv/helix/channels/ads";
const TWITCH_SNOOZE_URL = "https://api.twitch.tv/helix/channels/ads/schedule/snooze";

async function authorizeAds(ctx: ActionCtx, instanceId: Id<"instances">, scope: string): Promise<AuthorizedTwitchCall> {
  try {
    return await authorizeTwitch(ctx, instanceId, scope);
  } catch (err) {
    if (err instanceof ConvexError && err.data === missingTwitchScopeMessage(scope)) {
      throw new ConvexError(AD_SCOPE_MISSING_MESSAGE);
    }
    throw err;
  }
}

const OPERATIONS: Record<
  AdHelixOperation,
  { url: string; method: "GET" | "POST"; viaEngine: (engine: EngineApi) => Promise<TwitchHelixResult> }
> = {
  read: { url: TWITCH_ADS_URL, method: "GET", viaEngine: (engine) => engine.twitchGetAdSchedule() },
  snooze: { url: TWITCH_SNOOZE_URL, method: "POST", viaEngine: (engine) => engine.twitchSnoozeNextAd() },
};

export async function callHelix(
  call: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  operation: AdHelixOperation
): Promise<unknown> {
  const { url, method, viaEngine } = OPERATIONS[operation];
  let response: Response;
  try {
    response = await helixResponse(route, {
      operation: operation === "read" ? "getAdSchedule" : "snoozeNextAd",
      kind: operation === "read" ? "read" : "write",
      viaEngine,
      direct: () =>
        fetch(`${url}?broadcaster_id=${encodeURIComponent(call.broadcasterUserId)}`, {
          method,
          headers: { Authorization: `Bearer ${call.accessToken}`, "Client-Id": call.clientId },
        }),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConvexError(adHelixErrorMessage(operation, 0, `Twitch could not be reached (${reason})`));
  }
  const parsed = await readAdAnswer(operation, response);
  if (!parsed.ok) {
    throw new ConvexError(parsed.message);
  }
  return parsed.body;
}

export const getSchedule = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<AdSchedule> => {
    const call = await authorizeAds(ctx, args.instanceId, AD_READ_SCOPE);
    const body = await callHelix(call, await twitchHelixRoute(ctx, args.instanceId, "twitch.ads"), "read");
    const schedule = parseHelixAdSchedule(body, new Date().toISOString());
    if (!schedule) {
      throw new ConvexError(AD_SCHEDULE_UNREADABLE_MESSAGE);
    }
    return schedule;
  },
});

export const snoozeNextAd = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<AdSnoozeResult> => {
    const call = await authorizeAds(ctx, args.instanceId, AD_MANAGE_SCOPE);
    const body = await callHelix(call, await twitchHelixRoute(ctx, args.instanceId, "twitch.ads"), "snooze");
    const result = parseHelixSnoozeResult(body, new Date().toISOString());
    if (!result) {
      throw new ConvexError(AD_SNOOZE_UNREADABLE_MESSAGE);
    }
    return result;
  },
});
