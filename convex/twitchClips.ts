import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

// Clip creation for the dashboard command bar's Clip button.
//
// This goes straight to Helix rather than through the engine: the engine's
// Api surface has no clip method, and Convex already holds a refreshable
// broadcaster token for exactly this kind of call (see
// platformRealtime.ensureFreshTwitchToken, which the EventSub layer uses).
// The `clips:edit` scope is already part of TWITCH_INTEGRATION_SCOPES, so a
// channel connected through Settings → Integrations can clip with no
// re-consent.

const TWITCH_CLIPS_URL = "https://api.twitch.tv/helix/clips";

export interface CreateClipResult {
  clipId: string;
  /** Twitch's clip editor URL — the clip is a draft until trimmed and published there. */
  editUrl: string;
}

export const createClip = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<CreateClipResult> => {
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
      throw new Error("Twitch is not connected for this instance");
    }

    const clientId = process.env.AUTH_TWITCH_ID;
    if (!clientId) {
      throw new Error("AUTH_TWITCH_ID env var is not set");
    }

    const response = await fetch(`${TWITCH_CLIPS_URL}?broadcaster_id=${token.broadcasterUserId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Client-Id": clientId,
      },
    });

    // Twitch answers 404 when the channel isn't live and 403 when clipping is
    // disabled for the channel — both are ordinary states worth naming rather
    // than surfacing as a raw status code.
    if (response.status === 404) {
      throw new Error("Twitch has nothing to clip — the channel has to be live.");
    }
    if (response.status === 403) {
      throw new Error("Twitch refused the clip. Clipping may be disabled for this channel.");
    }
    if (!response.ok) {
      throw new Error(`Twitch clip creation failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { data: Array<{ id: string; edit_url: string }> };
    const clip = data.data[0];
    if (!clip) {
      throw new Error("Twitch accepted the request but returned no clip");
    }
    return { clipId: clip.id, editUrl: clip.edit_url };
  },
});
