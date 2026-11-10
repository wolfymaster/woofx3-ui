import { getAuthUserId } from "@convex-dev/auth/server";
import { type CreatedClip, readCreatedClipAnswer } from "@shared/twitch-clips";
import { TWITCH_NOT_CONNECTED_MESSAGE } from "@shared/twitch-link-refusal";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { OUTBOUND_FETCH_TIMEOUT_MS } from "./lib/outboundTimeouts";
import type { AuthorizedTwitchCall } from "./lib/twitchAuth";
import { helixResponse, type TwitchHelixRoute, twitchHelixRoute } from "./lib/twitchEngineHelix";

// Clip creation for the dashboard command bar's Clip button.
//
// This goes straight to Helix with the refreshable broadcaster token Convex
// holds (see platformRealtime.ensureFreshTwitchToken, which the EventSub layer
// uses), or through the instance's engine (convex/lib/twitchEngineHelix.ts).
// The `clips:edit` scope is already part of TWITCH_INTEGRATION_SCOPES, so a
// channel connected through Settings → Integrations can clip with no
// re-consent.

const TWITCH_CLIPS_URL = "https://api.twitch.tv/helix/clips";

export const createClip = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<CreatedClip> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const isMember = await ctx.runQuery(internal.platformRealtime.checkMembership, {
      instanceId: args.instanceId,
      userId,
    });
    if (!isMember) {
      throw new Error("Not a member of this instance");
    }

    const token = await ctx.runAction(internal.platformRealtime.ensureFreshTwitchToken, {
      instanceId: args.instanceId,
    });
    if (!token) {
      throw new Error(TWITCH_NOT_CONNECTED_MESSAGE);
    }

    const clientId = process.env.AUTH_TWITCH_ID;
    if (!clientId) {
      throw new Error("AUTH_TWITCH_ID env var is not set");
    }

    return createClipOnTwitch(
      { accessToken: token.accessToken, broadcasterUserId: token.broadcasterUserId, clientId },
      await twitchHelixRoute(ctx, args.instanceId)
    );
  },
});

export async function createClipOnTwitch(
  { accessToken, broadcasterUserId, clientId }: AuthorizedTwitchCall,
  route: TwitchHelixRoute
): Promise<CreatedClip> {
  const response = await helixResponse(route, {
    operation: "createClip",
    kind: "write",
    viaEngine: (engine) => engine.twitchCreateClip(),
    direct: () =>
      fetch(`${TWITCH_CLIPS_URL}?broadcaster_id=${broadcasterUserId}`, {
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": clientId,
        },
      }),
  });

  return readCreatedClipAnswer(response);
}
