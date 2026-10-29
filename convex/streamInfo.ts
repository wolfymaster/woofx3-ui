import { getAuthUserId } from "@convex-dev/auth/server";
import {
  categorySearchProblem,
  characterCount,
  isEmptyChanges,
  MAX_PRESET_NAME_LENGTH,
  markerDescriptionProblem,
  NOTHING_TO_UPDATE_MESSAGE,
  readCategoryAnswer,
  readChannelInfoAnswer,
  readMarkerAnswer,
  readModifyChannelAnswer,
  readSearchCategoriesAnswer,
  SEARCH_RESULT_LIMIT,
  STREAM_INFO_SCOPE,
  type StreamCategory,
  type StreamInfo,
  type StreamInfoChanges,
  type StreamInfoField,
  type StreamMarker,
  streamInfoChangesProblem,
  toHelixPatch,
  unappliedFields,
  withBoxArt,
} from "@shared/stream-info";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { action, type MutationCtx, mutation, query } from "./_generated/server";
import { getInstanceMembership, isInstanceMember } from "./lib/teamAccess";
import { type AuthorizedTwitchCall, authorizeTwitch } from "./lib/twitchAuth";
import { helixResponse, type TwitchHelixRoute, twitchHelixRoute } from "./lib/twitchEngineHelix";

// Title, category and tags for the dashboard's Stream info widget, plus stream
// markers and the named presets that apply a whole set in one click.
//
// Straight to Helix, like convex/twitchBroadcast.ts and convex/pins.ts, unless
// the engine advertises twitch.streamInfo and makes the same calls itself
// (convex/lib/twitchEngineHelix.ts). Convex holds a refreshable broadcaster
// token either way, so editing the channel keeps working while no engine is
// running.
// Every call runs under channel:manage:broadcast, reads included. Reading
// channel information needs no scope on Helix, but the widget exists to edit,
// and one scope gate keeps "reconnect Twitch" a single, predictable state
// rather than a card that shows data and then refuses every button.

const TWITCH_CHANNELS_URL = "https://api.twitch.tv/helix/channels";
const TWITCH_GAMES_URL = "https://api.twitch.tv/helix/games";
const TWITCH_SEARCH_CATEGORIES_URL = "https://api.twitch.tv/helix/search/categories";
const TWITCH_MARKERS_URL = "https://api.twitch.tv/helix/streams/markers";

const MAX_PRESETS = 50;

const categoryValidator = v.union(
  v.null(),
  v.object({ id: v.string(), name: v.string(), boxArtUrl: v.optional(v.string()) })
);

function helixHeaders(call: AuthorizedTwitchCall): Record<string, string> {
  return { Authorization: `Bearer ${call.accessToken}`, "Client-Id": call.clientId };
}

export async function fetchChannelInfo(call: AuthorizedTwitchCall, route: TwitchHelixRoute): Promise<StreamInfo> {
  const response = await helixResponse(route, {
    operation: "getChannelInformation",
    kind: "read",
    viaEngine: (engine) => engine.twitchGetChannelInformation(),
    direct: () =>
      fetch(`${TWITCH_CHANNELS_URL}?broadcaster_id=${call.broadcasterUserId}`, {
        headers: helixHeaders(call),
      }),
  });
  return readChannelInfoAnswer(response);
}

/** Box art for a category, which Get Channel Information does not return. */
export async function fetchCategory(
  call: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  categoryId: string
): Promise<StreamCategory | null> {
  const response = await helixResponse(route, {
    operation: "getGames",
    kind: "read",
    viaEngine: (engine) => engine.twitchGetGames({ id: categoryId }),
    direct: () =>
      fetch(`${TWITCH_GAMES_URL}?id=${encodeURIComponent(categoryId)}`, {
        headers: helixHeaders(call),
      }),
  });
  return readCategoryAnswer(response);
}

/** The channel with its category's box art; see `withBoxArt`. */
async function readChannel(
  call: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  known?: { categoryId: string; boxArtUrl: string }
): Promise<StreamInfo> {
  return withBoxArt(await fetchChannelInfo(call, route), known, (categoryId) => fetchCategory(call, route, categoryId));
}

export const getChannelInfo = action({
  args: {
    instanceId: v.id("instances"),
    knownBoxArt: v.optional(v.object({ categoryId: v.string(), boxArtUrl: v.string() })),
  },
  handler: async (ctx, args): Promise<StreamInfo> => {
    const call = await authorizeTwitch(ctx, args.instanceId, STREAM_INFO_SCOPE);
    return readChannel(call, await twitchHelixRoute(ctx, args.instanceId, "twitch.streamInfo"), args.knownBoxArt);
  },
});

export const searchCategories = action({
  args: { instanceId: v.id("instances"), query: v.string() },
  handler: async (ctx, args): Promise<StreamCategory[]> => {
    const text = args.query.trim();
    if (!text) {
      return [];
    }
    const problem = categorySearchProblem(text);
    if (problem) {
      throw new Error(problem);
    }
    const call = await authorizeTwitch(ctx, args.instanceId, STREAM_INFO_SCOPE);
    return searchCategoriesOnTwitch(call, await twitchHelixRoute(ctx, args.instanceId, "twitch.streamInfo"), text);
  },
});

export async function searchCategoriesOnTwitch(
  call: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  text: string
): Promise<StreamCategory[]> {
  const url = `${TWITCH_SEARCH_CATEGORIES_URL}?query=${encodeURIComponent(text)}&first=${SEARCH_RESULT_LIMIT}`;
  const response = await helixResponse(route, {
    operation: "searchCategories",
    kind: "read",
    viaEngine: (engine) => engine.twitchSearchCategories({ query: text, first: SEARCH_RESULT_LIMIT }),
    direct: () => fetch(url, { headers: helixHeaders(call) }),
  });
  return readSearchCategoriesAnswer(response);
}

function assertValidChanges(changes: StreamInfoChanges): void {
  const problem = streamInfoChangesProblem(changes);
  if (problem) {
    throw new Error(problem);
  }
}

/**
 * Writes only the fields the caller passes: an omitted field is left as
 * Twitch has it, so a title changed elsewhere since the widget loaded is not
 * reverted by a save that only touched tags. `category: null` clears it.
 *
 * Returns the channel as Twitch holds it afterwards, with any requested field
 * Twitch did not take. It answers 204 even when it ignores a value, so the
 * read-back is the only honest answer; Twitch's own 400 message decides tag
 * characters, which the widget only warns about.
 */
export const updateChannelInfo = action({
  args: {
    instanceId: v.id("instances"),
    title: v.optional(v.string()),
    category: v.optional(categoryValidator),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ info: StreamInfo; unapplied: StreamInfoField[] }> => {
    const changes: StreamInfoChanges = {};
    if (args.title !== undefined) {
      changes.title = args.title.trim();
    }
    if (args.category !== undefined) {
      changes.category = args.category;
    }
    if (args.tags !== undefined) {
      changes.tags = args.tags;
    }
    if (isEmptyChanges(changes)) {
      throw new Error(NOTHING_TO_UPDATE_MESSAGE);
    }
    assertValidChanges(changes);

    const call = await authorizeTwitch(ctx, args.instanceId, STREAM_INFO_SCOPE);
    const route = await twitchHelixRoute(ctx, args.instanceId, "twitch.streamInfo");
    await modifyChannelInformation(call, route, changes);

    const info = await readChannel(call, route);
    return { info, unapplied: unappliedFields(changes, info) };
  },
});

export async function modifyChannelInformation(
  call: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  changes: StreamInfoChanges
): Promise<void> {
  const patch = toHelixPatch(changes);
  const response = await helixResponse(route, {
    operation: "modifyChannelInformation",
    kind: "write",
    viaEngine: (engine) => engine.twitchModifyChannelInformation(patch),
    direct: () =>
      fetch(`${TWITCH_CHANNELS_URL}?broadcaster_id=${call.broadcasterUserId}`, {
        method: "PATCH",
        headers: { ...helixHeaders(call), "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
  });
  await readModifyChannelAnswer(response);
}

export const createMarker = action({
  args: { instanceId: v.id("instances"), description: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ positionSeconds: number | null; createdAt: string | null }> => {
    const description = args.description?.trim() ?? "";
    const problem = markerDescriptionProblem(description);
    if (problem) {
      throw new Error(problem);
    }

    const call = await authorizeTwitch(ctx, args.instanceId, STREAM_INFO_SCOPE);
    return createMarkerOnTwitch(call, await twitchHelixRoute(ctx, args.instanceId, "twitch.streamInfo"), description);
  },
});

export async function createMarkerOnTwitch(
  call: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  description: string
): Promise<StreamMarker> {
  const response = await helixResponse(route, {
    operation: "createStreamMarker",
    kind: "write",
    viaEngine: (engine) => engine.twitchCreateStreamMarker(description ? { description } : {}),
    direct: () =>
      fetch(TWITCH_MARKERS_URL, {
        method: "POST",
        headers: { ...helixHeaders(call), "Content-Type": "application/json" },
        body: JSON.stringify(
          description ? { user_id: call.broadcasterUserId, description } : { user_id: call.broadcasterUserId }
        ),
      }),
  });

  return readMarkerAnswer(response);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface StreamInfoPreset {
  id: Id<"streamInfoPresets">;
  name: string;
  info: StreamInfo;
}

function toPreset(row: Doc<"streamInfoPresets">): StreamInfoPreset {
  return {
    id: row._id,
    name: row.name,
    info: {
      title: row.title,
      category:
        row.categoryId && row.categoryName
          ? { id: row.categoryId, name: row.categoryName, boxArtUrl: row.categoryBoxArtUrl }
          : null,
      tags: row.tags,
    },
  };
}

async function requireMember(ctx: MutationCtx, instanceId: Id<"instances">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  if (!(await getInstanceMembership(ctx, instanceId, userId))) {
    throw new Error("Not a member of this instance");
  }
  return userId;
}

export const listPresets = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<StreamInfoPreset[]> => {
    if (!(await isInstanceMember(ctx, args.instanceId))) {
      return [];
    }
    const rows = await ctx.db
      .query("streamInfoPresets")
      .withIndex("by_instance_name", (q) => q.eq("instanceId", args.instanceId))
      .take(MAX_PRESETS);
    return rows.map(toPreset);
  },
});

/** Saves under `name`, replacing a preset that already has it: names are how people pick one. */
export const savePreset = mutation({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    title: v.string(),
    category: categoryValidator,
    tags: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"streamInfoPresets">> => {
    const userId = await requireMember(ctx, args.instanceId);
    const name = args.name.trim();
    if (!name) {
      throw new Error("A preset needs a name");
    }
    if (characterCount(name) > MAX_PRESET_NAME_LENGTH) {
      throw new Error(`Preset names are limited to ${MAX_PRESET_NAME_LENGTH} characters`);
    }
    const title = args.title.trim();
    assertValidChanges({ title, tags: args.tags, category: args.category });

    const fields = {
      title,
      categoryId: args.category?.id,
      categoryName: args.category?.name,
      categoryBoxArtUrl: args.category?.boxArtUrl,
      tags: args.tags,
      updatedAt: Date.now(),
    };

    const existing = await ctx.db
      .query("streamInfoPresets")
      .withIndex("by_instance_name", (q) => q.eq("instanceId", args.instanceId).eq("name", name))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }

    const count = (
      await ctx.db
        .query("streamInfoPresets")
        .withIndex("by_instance_name", (q) => q.eq("instanceId", args.instanceId))
        .take(MAX_PRESETS)
    ).length;
    if (count >= MAX_PRESETS) {
      throw new Error(`You can keep at most ${MAX_PRESETS} presets. Delete one to save another.`);
    }
    return ctx.db.insert("streamInfoPresets", {
      instanceId: args.instanceId,
      name,
      createdByUserId: userId,
      ...fields,
    });
  },
});

export const removePreset = mutation({
  args: { instanceId: v.id("instances"), presetId: v.id("streamInfoPresets") },
  handler: async (ctx, args): Promise<void> => {
    await requireMember(ctx, args.instanceId);
    const preset = await ctx.db.get(args.presetId);
    if (!preset || preset.instanceId !== args.instanceId) {
      throw new Error("Preset not found");
    }
    await ctx.db.delete(args.presetId);
  },
});
