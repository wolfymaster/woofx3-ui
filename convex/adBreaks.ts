import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import {
  AD_MANAGE_SCOPE,
  AD_READ_SCOPE,
  AD_SCOPE_MISSING_MESSAGE,
  type AdHelixOperation,
  type AdSchedule,
  type AdSnoozeResult,
  adHelixErrorMessage,
  helixErrorText,
  parseHelixAdSchedule,
  parseHelixSnoozeResult,
} from "./lib/adBreaks";
import { type AuthorizedTwitchCall, authorizeTwitch, missingTwitchScopeMessage } from "./lib/twitchAuth";

// The Ad breaks dashboard widget's schedule and snooze, straight to Helix like
// convex/pins.ts and convex/streamInfo.ts: Convex already holds a refreshable
// broadcaster token, and Twitch's ad schedule is not something the generic
// engine surface should describe. The engine's part is the ad-break events,
// which reach the widget over the stream-event session.
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

async function callHelix(
  call: AuthorizedTwitchCall,
  operation: AdHelixOperation,
  url: string,
  method: "GET" | "POST"
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${url}?broadcaster_id=${encodeURIComponent(call.broadcasterUserId)}`, {
      method,
      headers: { Authorization: `Bearer ${call.accessToken}`, "Client-Id": call.clientId },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConvexError(adHelixErrorMessage(operation, 0, `Twitch could not be reached (${reason})`));
  }
  if (!response.ok) {
    throw new ConvexError(adHelixErrorMessage(operation, response.status, helixErrorText(await response.text())));
  }
  return response.json();
}

export const getSchedule = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<AdSchedule> => {
    const call = await authorizeAds(ctx, args.instanceId, AD_READ_SCOPE);
    const body = await callHelix(call, "read", TWITCH_ADS_URL, "GET");
    const schedule = parseHelixAdSchedule(body, new Date().toISOString());
    if (!schedule) {
      throw new ConvexError("Twitch answered with an ad schedule this page cannot read.");
    }
    return schedule;
  },
});

export const snoozeNextAd = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<AdSnoozeResult> => {
    const call = await authorizeAds(ctx, args.instanceId, AD_MANAGE_SCOPE);
    const body = await callHelix(call, "snooze", TWITCH_SNOOZE_URL, "POST");
    const result = parseHelixSnoozeResult(body, new Date().toISOString());
    if (!result) {
      throw new ConvexError("Twitch snoozed the ad but answered with something this page cannot read.");
    }
    return result;
  },
});
