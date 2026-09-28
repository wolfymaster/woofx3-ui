import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { action, type MutationCtx, mutation, query } from "./_generated/server";
import {
  BOX_ART_URL_PREFIX,
  categoriesFromHelix,
  categoryProblem,
  channelInfoFromHelix,
  characterCount,
  isEmptyChanges,
  MAX_PRESET_NAME_LENGTH,
  markerDescriptionProblem,
  STREAM_INFO_SCOPE,
  type StreamCategory,
  type StreamInfo,
  type StreamInfoChanges,
  type StreamInfoField,
  tagsProblem,
  titleProblem,
  toHelixPatch,
  unappliedFields,
} from "./lib/streamInfo";
import { getInstanceMembership, isInstanceMember } from "./lib/teamAccess";
import { type AuthorizedTwitchCall, authorizeTwitch } from "./lib/twitchAuth";

// Title, category and tags for the dashboard's Stream info widget, plus stream
// markers and the named presets that apply a whole set in one click.
//
// Straight to Helix, like convex/twitchBroadcast.ts and convex/pins.ts, rather
// than through the engine: Convex already holds a refreshable broadcaster
// token, so editing the channel keeps working while no engine is running.
// Every call runs under channel:manage:broadcast, reads included. Reading
// channel information needs no scope on Helix, but the widget exists to edit,
// and one scope gate keeps "reconnect Twitch" a single, predictable state
// rather than a card that shows data and then refuses every button.

const TWITCH_CHANNELS_URL = "https://api.twitch.tv/helix/channels";
const TWITCH_GAMES_URL = "https://api.twitch.tv/helix/games";
const TWITCH_SEARCH_CATEGORIES_URL = "https://api.twitch.tv/helix/search/categories";
const TWITCH_MARKERS_URL = "https://api.twitch.tv/helix/streams/markers";

const SEARCH_RESULT_LIMIT = 10;
/** Search Categories rejects an empty query; a very long one is never a real category name. */
const MAX_SEARCH_QUERY_LENGTH = 100;
const MAX_PRESETS = 50;

const categoryValidator = v.union(
  v.null(),
  v.object({ id: v.string(), name: v.string(), boxArtUrl: v.optional(v.string()) })
);

function helixHeaders(call: AuthorizedTwitchCall): Record<string, string> {
  return { Authorization: `Bearer ${call.accessToken}`, "Client-Id": call.clientId };
}

/**
 * An Error carrying Twitch's own reason when it gave one. Helix error bodies
 * are `{ error, status, message }`, and the message ("The tag contains an
 * invalid character") is the part a person can act on.
 */
async function helixFailure(what: string, response: Response): Promise<Error> {
  const text = await response.text();
  let reason = text;
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === "string" && body.message !== "") {
      reason = body.message;
    }
  } catch {
    // Not JSON: the raw text is the best reason available.
  }
  if (response.status === 401) {
    return new Error(`${what}: Twitch rejected the connection. Reconnect Twitch in Settings → Integrations.`);
  }
  if (response.status === 429) {
    return new Error(`${what}: Twitch is rate-limiting this. Try again in a moment.`);
  }
  return new Error(`${what}: ${reason || `Twitch answered ${response.status}`}`);
}

async function fetchChannelInfo(call: AuthorizedTwitchCall): Promise<StreamInfo> {
  const response = await fetch(`${TWITCH_CHANNELS_URL}?broadcaster_id=${call.broadcasterUserId}`, {
    headers: helixHeaders(call),
  });
  if (!response.ok) {
    throw await helixFailure("Couldn't read your stream info", response);
  }
  const info = channelInfoFromHelix(await response.json());
  if (!info) {
    throw new Error("Twitch returned no channel for this account");
  }
  return info;
}

/** Box art for a category, which Get Channel Information does not return. */
async function fetchCategory(call: AuthorizedTwitchCall, categoryId: string): Promise<StreamCategory | null> {
  const response = await fetch(`${TWITCH_GAMES_URL}?id=${encodeURIComponent(categoryId)}`, {
    headers: helixHeaders(call),
  });
  if (!response.ok) {
    // The art is decoration; the channel's info is still worth showing without it.
    return null;
  }
  return categoriesFromHelix(await response.json())[0] ?? null;
}

/**
 * The channel with its category's box art. `known` is art the caller already
 * has, reused when the category has not changed so a poll costs one Helix
 * call instead of two.
 */
async function readChannel(
  call: AuthorizedTwitchCall,
  known?: { categoryId: string; boxArtUrl: string }
): Promise<StreamInfo> {
  const info = await fetchChannelInfo(call);
  if (!info.category) {
    return info;
  }
  if (known && known.categoryId === info.category.id && known.boxArtUrl.startsWith(BOX_ART_URL_PREFIX)) {
    return { ...info, category: { ...info.category, boxArtUrl: known.boxArtUrl } };
  }
  const category = await fetchCategory(call, info.category.id);
  return { ...info, category: category ?? info.category };
}

export const getChannelInfo = action({
  args: {
    instanceId: v.id("instances"),
    knownBoxArt: v.optional(v.object({ categoryId: v.string(), boxArtUrl: v.string() })),
  },
  handler: async (ctx, args): Promise<StreamInfo> => {
    const call = await authorizeTwitch(ctx, args.instanceId, STREAM_INFO_SCOPE);
    return readChannel(call, args.knownBoxArt);
  },
});

export const searchCategories = action({
  args: { instanceId: v.id("instances"), query: v.string() },
  handler: async (ctx, args): Promise<StreamCategory[]> => {
    const text = args.query.trim();
    if (!text) {
      return [];
    }
    if (text.length > MAX_SEARCH_QUERY_LENGTH) {
      throw new Error(`Category searches are limited to ${MAX_SEARCH_QUERY_LENGTH} characters`);
    }
    const call = await authorizeTwitch(ctx, args.instanceId, STREAM_INFO_SCOPE);
    const url = `${TWITCH_SEARCH_CATEGORIES_URL}?query=${encodeURIComponent(text)}&first=${SEARCH_RESULT_LIMIT}`;
    const response = await fetch(url, { headers: helixHeaders(call) });
    if (!response.ok) {
      throw await helixFailure("Category search failed", response);
    }
    return categoriesFromHelix(await response.json());
  },
});

function assertValidChanges(changes: StreamInfoChanges): void {
  const problem =
    (changes.title !== undefined ? titleProblem(changes.title) : null) ??
    (changes.tags !== undefined ? tagsProblem(changes.tags) : null) ??
    (changes.category ? categoryProblem(changes.category) : null);
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
      throw new Error("Nothing to update");
    }
    assertValidChanges(changes);

    const call = await authorizeTwitch(ctx, args.instanceId, STREAM_INFO_SCOPE);
    const response = await fetch(`${TWITCH_CHANNELS_URL}?broadcaster_id=${call.broadcasterUserId}`, {
      method: "PATCH",
      headers: { ...helixHeaders(call), "Content-Type": "application/json" },
      body: JSON.stringify(toHelixPatch(changes)),
    });
    if (!response.ok) {
      throw await helixFailure("Couldn't update your stream info", response);
    }

    const info = await readChannel(call);
    return { info, unapplied: unappliedFields(changes, info) };
  },
});

export const createMarker = action({
  args: { instanceId: v.id("instances"), description: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ positionSeconds: number | null; createdAt: string | null }> => {
    const description = args.description?.trim() ?? "";
    const problem = markerDescriptionProblem(description);
    if (problem) {
      throw new Error(problem);
    }

    const call = await authorizeTwitch(ctx, args.instanceId, STREAM_INFO_SCOPE);
    const response = await fetch(TWITCH_MARKERS_URL, {
      method: "POST",
      headers: { ...helixHeaders(call), "Content-Type": "application/json" },
      body: JSON.stringify(
        description ? { user_id: call.broadcasterUserId, description } : { user_id: call.broadcasterUserId }
      ),
    });

    // Helix answers 404 both when the channel is not live and when it has no
    // VOD to mark (past broadcasts are off), and does not say which. The user
    // id is the token's own, so the third documented 404, an unknown user, is
    // not a case here. A 403 (token user is not the owner or an editor) is
    // left to helixFailure, which carries Twitch's message.
    if (response.status === 404) {
      throw new Error(
        "Not live, or past broadcasts are off (Twitch VOD settings); reruns and premieres can't be marked."
      );
    }
    if (!response.ok) {
      throw await helixFailure("Couldn't add a marker", response);
    }

    const body = (await response.json()) as { data?: Array<{ position_seconds?: unknown; created_at?: unknown }> };
    const marker = body.data?.[0];
    return {
      positionSeconds: typeof marker?.position_seconds === "number" ? marker.position_seconds : null,
      createdAt: typeof marker?.created_at === "string" ? marker.created_at : null,
    };
  },
});

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
