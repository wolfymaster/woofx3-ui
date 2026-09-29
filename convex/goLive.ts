import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  type GoLiveCompletion,
  type GoLiveStepOutcome,
  isGoLiveCheckId,
  type LastGoLive,
  type OverlayFacts,
  type StreamInfoFacts,
  type TwitchLinkFacts,
  type WorkflowFacts,
} from "./lib/goLiveFacts";
import { isMarkerRequestPending } from "./lib/goLiveMarker";
import { getInstanceMembership, isInstanceMember } from "./lib/teamAccess";
import {
  type AuthorizedTwitchCall,
  authorizeTwitchUnattended,
  authorizeTwitchUnscoped,
  freshTwitchCredentials,
  missingTwitchScopeMessage,
} from "./lib/twitchAuth";
import { createStreamMarker, fetchChannelInfo } from "./lib/twitchChannels";
import { MAX_CHAT_MESSAGE_LENGTH, sendChatMessage } from "./lib/twitchChat";
import { missingRequiredTwitchScopes } from "./lib/twitchScopeHealth";

// The Go live checklist: a pre-flight run just before a stream starts, so a
// broken setup is found by the streamer rather than by their viewers.
//
// Each check that has to ask Twitch is its own action, so the browser runs them
// side by side and shows each result as it lands instead of waiting for the
// slowest. The OBS check asks the engine through the generic field-options
// request (fieldOptions.dispatch), as a scene picker would. What Convex
// already holds arrives through the `checklist` query.

const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const SEND_SCOPE = "user:write:chat";
const MARKER_SCOPE = "channel:manage:broadcast";
const MARKER_DESCRIPTION = "Stream start";
const MAX_SOURCE_KEYS_READ = 500;
/** Past this many enabled workflows the checklist just says "20+". */
const WORKFLOW_COUNT_CAP = 20;

async function requireMemberForAction(ctx: ActionCtx, instanceId: Id<"instances">): Promise<void> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Sign in to run the go live checklist");
  }
  const isMember: boolean = await ctx.runQuery(internal.platformRealtime.checkMembership, { instanceId, userId });
  if (!isMember) {
    throw new ConvexError("You are not a member of this instance");
  }
}

function messageOf(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// What Convex already knows
// ---------------------------------------------------------------------------

export const checklist = query({
  args: { instanceId: v.id("instances") },
  handler: async (
    ctx,
    args
  ): Promise<{
    dismissedCheckIds: string[];
    lastGoLive: LastGoLive | null;
    markerPending: boolean;
    workflows: WorkflowFacts;
  } | null> => {
    if (!(await isInstanceMember(ctx, args.instanceId))) {
      return null;
    }

    const row = await ctx.db
      .query("goLiveChecklists")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();

    // Workflow documents carry whole definitions, so read only as many as the
    // answer needs: enabled ones up to the cap, and one of any kind when none is.
    const enabled = await ctx.db
      .query("workflows")
      .withIndex("by_instance_enabled", (q) => q.eq("instanceId", args.instanceId).eq("isEnabled", true))
      .take(WORKFLOW_COUNT_CAP + 1);
    const anyWorkflow =
      enabled.length > 0 ||
      (await ctx.db
        .query("workflows")
        .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
        .first()) !== null;

    return {
      dismissedCheckIds: row?.dismissedCheckIds ?? [],
      lastGoLive: row?.lastCompletedAt
        ? {
            completedAt: row.lastCompletedAt,
            title: row.lastTitle ?? null,
            categoryId: row.lastCategoryId ?? null,
            categoryName: row.lastCategoryName ?? null,
          }
        : null,
      // Date.now() in a query is fixed at run time; a request that lapses
      // while the page is open simply reads as pending until the next change.
      markerPending: isMarkerRequestPending(row?.pendingMarkerRequestedAt, Date.now()),
      workflows: {
        any: anyWorkflow,
        enabled: Math.min(enabled.length, WORKFLOW_COUNT_CAP),
        enabledCapped: enabled.length > WORKFLOW_COUNT_CAP,
      },
    };
  },
});

/**
 * Kept apart from `checklist` because a browser source loading its URL
 * rewrites the key's lastUsedAt; only this query reruns when that happens.
 */
export const overlays = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<OverlayFacts | null> => {
    if (!(await isInstanceMember(ctx, args.instanceId))) {
      return null;
    }

    const scene = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();

    // Preview keys belong to the scene editor's own canvas; only the others
    // are what a streamer pastes into OBS.
    const sourceKeys = (
      await ctx.db
        .query("browserSourceKeys")
        .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
        .take(MAX_SOURCE_KEYS_READ)
    ).filter((key) => key.purpose !== "preview");

    const byRecentUse = [...sourceKeys].sort(
      (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || b.createdAt - a.createdAt
    );
    const featured = byRecentUse[0] ?? null;

    return {
      hasScene: scene !== null,
      browserSourceKeyCount: sourceKeys.length,
      featuredKey: featured?.key ?? null,
      lastLoadedAt: featured?.lastUsedAt ?? null,
    };
  },
});

export const setCheckDismissed = mutation({
  args: { instanceId: v.id("instances"), checkId: v.string(), dismissed: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    if (!isGoLiveCheckId(args.checkId)) {
      throw new ConvexError(`There is no "${args.checkId}" check to dismiss`);
    }
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await getInstanceMembership(ctx, args.instanceId, userId))) {
      throw new ConvexError("You are not a member of this instance");
    }

    const row = await ctx.db
      .query("goLiveChecklists")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();
    const current = new Set(row?.dismissedCheckIds ?? []);
    if (args.dismissed) {
      current.add(args.checkId);
    } else {
      current.delete(args.checkId);
    }
    const dismissedCheckIds = Array.from(current).sort();

    if (row) {
      await ctx.db.patch(row._id, { dismissedCheckIds, updatedAt: Date.now() });
      return;
    }
    await ctx.db.insert("goLiveChecklists", {
      instanceId: args.instanceId,
      dismissedCheckIds,
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Internal state used by the actions
// ---------------------------------------------------------------------------

/** The Twitch link without its tokens, which never leave the backend. */
export const twitchLinkSummary = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<{ login: string; scopes: string[] } | null> => {
    const links = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(20);
    const twitch = links.find((link) => link.platform === "twitch");
    if (!twitch) {
      return null;
    }
    return { login: twitch.platformUsername, scopes: twitch.scopes };
  },
});

export const recordCompletion = internalMutation({
  args: {
    instanceId: v.id("instances"),
    completedAt: v.number(),
    channel: v.optional(v.object({ title: v.string(), categoryId: v.string(), categoryName: v.string() })),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db
      .query("goLiveChecklists")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();
    // A channel read that failed leaves the previous title and category in
    // place: stale comparison data beats none.
    const patch = {
      lastCompletedAt: args.completedAt,
      updatedAt: args.completedAt,
      ...(args.channel
        ? {
            lastTitle: args.channel.title,
            lastCategoryId: args.channel.categoryId,
            lastCategoryName: args.channel.categoryName,
          }
        : {}),
    };
    if (row) {
      await ctx.db.patch(row._id, patch);
      return;
    }
    await ctx.db.insert("goLiveChecklists", { instanceId: args.instanceId, dismissedCheckIds: [], ...patch });
  },
});

// ---------------------------------------------------------------------------
// Checks that ask Twitch
// ---------------------------------------------------------------------------

/** Scopes Twitch reports for the token, or null when it refuses the token outright. */
async function validateTwitchToken(accessToken: string): Promise<string[] | null> {
  const response = await fetch(TWITCH_VALIDATE_URL, { headers: { Authorization: `OAuth ${accessToken}` } });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new ConvexError(`Twitch didn't answer the connection check (${response.status}). Try again in a moment.`);
  }
  const body = (await response.json()) as { scopes?: unknown };
  return Array.isArray(body.scopes) ? body.scopes.filter((scope): scope is string => typeof scope === "string") : [];
}

export const checkTwitch = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<TwitchLinkFacts> => {
    await requireMemberForAction(ctx, args.instanceId);

    const link: { login: string; scopes: string[] } | null = await ctx.runQuery(internal.goLive.twitchLinkSummary, {
      instanceId: args.instanceId,
    });
    if (!link) {
      return { linked: false };
    }

    let accessToken: string;
    try {
      const token = await ctx.runAction(internal.platformRealtime.ensureFreshTwitchToken, {
        instanceId: args.instanceId,
      });
      if (!token) {
        return { linked: false };
      }
      accessToken = token.accessToken;
    } catch {
      return {
        linked: true,
        login: link.login,
        tokenValid: false,
        tokenProblem: "Twitch refused to renew the connection",
        missingScopes: missingRequiredTwitchScopes(link.scopes),
      };
    }

    const granted = await validateTwitchToken(accessToken);
    if (granted === null) {
      return {
        linked: true,
        login: link.login,
        tokenValid: false,
        tokenProblem: "Twitch no longer accepts the connection",
        missingScopes: missingRequiredTwitchScopes(link.scopes),
      };
    }
    return {
      linked: true,
      login: link.login,
      tokenValid: true,
      tokenProblem: null,
      missingScopes: missingRequiredTwitchScopes(granted),
    };
  },
});

export const checkStreamInfo = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<StreamInfoFacts> => {
    await requireMemberForAction(ctx, args.instanceId);

    const link: { login: string; scopes: string[] } | null = await ctx.runQuery(internal.goLive.twitchLinkSummary, {
      instanceId: args.instanceId,
    });
    if (!link) {
      return { kind: "unlinked" };
    }

    try {
      const twitch = await authorizeTwitchUnscoped(ctx, args.instanceId);
      const channel = await fetchChannelInfo(twitch);
      return { kind: "ok", login: link.login, ...channel };
    } catch (error) {
      throw new ConvexError(`Couldn't read your stream info from Twitch: ${messageOf(error)}`);
    }
  },
});

// ---------------------------------------------------------------------------
// Finishing the checklist
// ---------------------------------------------------------------------------

export const complete = action({
  args: {
    instanceId: v.id("instances"),
    /** Posted to chat as the broadcaster when present. */
    announcement: v.optional(v.string()),
    /** Dropped now when live, else when the stream next goes live. */
    dropMarker: v.boolean(),
  },
  handler: async (ctx, args): Promise<GoLiveCompletion> => {
    await requireMemberForAction(ctx, args.instanceId);

    const announcementText = args.announcement?.trim();
    if (args.announcement !== undefined && !announcementText) {
      throw new ConvexError("The go live announcement needs some text");
    }
    if (announcementText && announcementText.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new ConvexError(`Chat messages are limited to ${MAX_CHAT_MESSAGE_LENGTH} characters`);
    }

    const link: { login: string; scopes: string[] } | null = await ctx.runQuery(internal.goLive.twitchLinkSummary, {
      instanceId: args.instanceId,
    });
    if (!link) {
      throw new ConvexError("Connect Twitch in Settings → Integrations before finishing the checklist");
    }
    // One token for every Helix call below; the membership check above
    // already stands in for authorizeTwitch's, and scopes are checked per step.
    let twitch: AuthorizedTwitchCall;
    try {
      twitch = await freshTwitchCredentials(ctx, args.instanceId);
    } catch (error) {
      throw new ConvexError(`Twitch needs reconnecting: ${messageOf(error)}`);
    }
    const requireScope = (scope: string) => {
      if (!link.scopes.includes(scope)) {
        throw new Error(missingTwitchScopeMessage(scope));
      }
    };

    // Each step reports its own outcome: a chat send refused by automod should
    // not stop the marker, and neither should hide the other's result.
    let announcement: GoLiveStepOutcome = { status: "skipped", reason: "No announcement was asked for" };
    if (announcementText) {
      try {
        requireScope(SEND_SCOPE);
        await sendChatMessage(twitch, announcementText, { pin: false });
        announcement = { status: "done" };
      } catch (error) {
        announcement = { status: "failed", message: messageOf(error) };
      }
    }

    let marker: GoLiveStepOutcome = { status: "skipped", reason: "No stream marker was asked for" };
    if (args.dropMarker) {
      try {
        requireScope(MARKER_SCOPE);
        const request: "live" | "queued" = await ctx.runMutation(internal.goLive.requestStreamStartMarker, {
          instanceId: args.instanceId,
          requestedAt: Date.now(),
        });
        if (request === "live") {
          await createStreamMarker(twitch, MARKER_DESCRIPTION);
          marker = { status: "done" };
        } else {
          marker = { status: "queued", reason: "The marker will be dropped when your stream goes live." };
        }
      } catch (error) {
        marker = { status: "failed", message: messageOf(error) };
      }
    }

    // A run where everything asked for failed did not finish the checklist, so
    // it must not become the "last go-live" the next title check compares to.
    const requested = [announcement, marker].filter((outcome) => outcome.status !== "skipped");
    const allFailed = requested.length > 0 && requested.every((outcome) => outcome.status === "failed");
    if (!allFailed) {
      let channel: { title: string; categoryId: string; categoryName: string } | undefined;
      try {
        const info = await fetchChannelInfo(twitch);
        channel = { title: info.title, categoryId: info.categoryId, categoryName: info.categoryName };
      } catch {
        channel = undefined;
      }
      await ctx.runMutation(internal.goLive.recordCompletion, {
        instanceId: args.instanceId,
        completedAt: Date.now(),
        channel,
      });
    }

    return { announcement, marker };
  },
});

/**
 * Decides, in one transaction with the live state, whether the marker can be
 * dropped now or must wait: checking live-ness in the action and writing the
 * request afterwards would lose a request made just as the stream started.
 */
export const requestStreamStartMarker = internalMutation({
  args: { instanceId: v.id("instances"), requestedAt: v.number() },
  handler: async (ctx, args): Promise<"live" | "queued"> => {
    const live = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();
    if (live?.isLive) {
      return "live";
    }

    const row = await ctx.db
      .query("goLiveChecklists")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { pendingMarkerRequestedAt: args.requestedAt, updatedAt: args.requestedAt });
    } else {
      await ctx.db.insert("goLiveChecklists", {
        instanceId: args.instanceId,
        dismissedCheckIds: [],
        pendingMarkerRequestedAt: args.requestedAt,
        updatedAt: args.requestedAt,
      });
    }
    return "queued";
  },
});

/**
 * Drops a marker requested before the stream started; scheduled by
 * claimPendingStreamStartMarker when the stream goes live. Nobody is waiting
 * on the result, so a failure is logged rather than thrown.
 */
export const dropStreamStartMarker = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<void> => {
    try {
      const twitch = await authorizeTwitchUnattended(ctx, args.instanceId, MARKER_SCOPE);
      await createStreamMarker(twitch, MARKER_DESCRIPTION);
    } catch (error) {
      console.warn(`[goLive] Couldn't drop the requested stream start marker: ${messageOf(error)}`);
    }
  },
});
