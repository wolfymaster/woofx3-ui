// Rules and shapes for a channel's stream info (title, category, tags) and
// stream markers, shared by the Convex actions that talk to Helix and the
// dashboard widget that edits them. One copy so the widget explains a
// rejection with exactly the rule the backend enforces.

/** The one scope every Stream info call runs under, reads included. */
export const STREAM_INFO_SCOPE = "channel:manage:broadcast";

/** Helix rejects a longer title on Modify Channel Information. */
export const MAX_TITLE_LENGTH = 140;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 25;
/** Helix rejects a longer description on Create Stream Marker. */
export const MAX_MARKER_DESCRIPTION_LENGTH = 140;
export const MAX_PRESET_NAME_LENGTH = 60;

// Twitch refuses spaces and punctuation in a tag. Letters and digits from any
// script are accepted, so this is Unicode-aware rather than [A-Za-z0-9].
// biome-ignore lint/complexity/useRegexLiterals: the client TypeScript target predates the `u` literal flag
const TAG_PATTERN = new RegExp("^[\\p{L}\\p{N}]+$", "u");

export interface StreamCategory {
  id: string;
  name: string;
  /** Sized box art URL, absent when Twitch has none for the category. */
  boxArtUrl?: string;
}

export interface StreamInfo {
  title: string;
  /** Null when the channel has no category set. */
  category: StreamCategory | null;
  tags: string[];
}

/**
 * Length as Twitch counts it: one per code point, so an emoji in a title is
 * one character, not the two UTF-16 units `String.length` reports.
 */
export function characterCount(text: string): number {
  return Array.from(text).length;
}

export interface LengthCounter {
  length: number;
  max: number;
  remaining: number;
  over: boolean;
  /** Within the last tenth of the limit, worth a warning colour before it bites. */
  near: boolean;
}

export function lengthCounter(text: string, max: number): LengthCounter {
  if (!(Number.isInteger(max) && max > 0)) {
    throw new Error(`lengthCounter: max must be a positive integer, got ${max}`);
  }
  const length = characterCount(text);
  const remaining = max - length;
  return { length, max, remaining, over: remaining < 0, near: remaining >= 0 && remaining <= Math.ceil(max / 10) };
}

export function titleCounter(title: string): LengthCounter {
  return lengthCounter(title, MAX_TITLE_LENGTH);
}

/** Why a single tag cannot be used, or null when Twitch will accept it. */
export function tagProblem(tag: string): string | null {
  if (tag.length === 0) {
    return "A tag can't be empty";
  }
  if (/\s/.test(tag)) {
    return "Tags can't contain spaces";
  }
  if (characterCount(tag) > MAX_TAG_LENGTH) {
    return `Tags are limited to ${MAX_TAG_LENGTH} characters`;
  }
  if (!TAG_PATTERN.test(tag)) {
    return "Tags can only use letters and numbers";
  }
  return null;
}

/**
 * Why `candidate` cannot join `existing`, or null when it can. Duplicates are
 * compared case-insensitively because Twitch treats "FPS" and "fps" as one tag.
 */
export function addTagProblem(existing: readonly string[], candidate: string): string | null {
  const problem = tagProblem(candidate);
  if (problem) {
    return problem;
  }
  const lowered = candidate.toLowerCase();
  if (existing.some((tag) => tag.toLowerCase() === lowered)) {
    return `"${candidate}" is already a tag`;
  }
  if (existing.length >= MAX_TAGS) {
    return `Twitch allows at most ${MAX_TAGS} tags`;
  }
  return null;
}

/** The first problem with a whole tag list, for the backend to refuse on. */
export function tagsProblem(tags: readonly string[]): string | null {
  const accepted: string[] = [];
  for (const tag of tags) {
    const problem = addTagProblem(accepted, tag);
    if (problem) {
      return problem;
    }
    accepted.push(tag);
  }
  return null;
}

/** Why a title cannot be saved, or null. Twitch refuses an empty title outright. */
export function titleProblem(title: string): string | null {
  if (title.trim().length === 0) {
    return "The title can't be empty";
  }
  if (characterCount(title) > MAX_TITLE_LENGTH) {
    return `Titles are limited to ${MAX_TITLE_LENGTH} characters`;
  }
  return null;
}

export function markerDescriptionProblem(description: string): string | null {
  if (characterCount(description) > MAX_MARKER_DESCRIPTION_LENGTH) {
    return `Marker descriptions are limited to ${MAX_MARKER_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map((tag) => tag.toLowerCase()));
  const right = new Set(b.map((tag) => tag.toLowerCase()));
  if (left.size !== right.size) {
    return false;
  }
  return Array.from(right).every((tag) => left.has(tag));
}

/** A Modify Channel Information body. */
export interface StreamInfoPatch {
  title?: string;
  game_id?: string;
  tags?: string[];
}

/**
 * The fields Modify Channel Information needs to turn `current` into `next`,
 * in Helix's own shape. A field that already matches is left out: sending an
 * unchanged title still counts against Twitch's edit rate limit and shows up
 * in the channel's activity as an edit.
 *
 * Tags compare as a case-insensitive set, since order and case are not
 * something a viewer can tell apart. A null category on `next` clears it,
 * which Helix spells as an empty `game_id`.
 */
export function diffStreamInfo(current: StreamInfo, next: StreamInfo): StreamInfoPatch {
  const patch: StreamInfoPatch = {};
  if (current.title !== next.title) {
    patch.title = next.title;
  }
  const currentCategoryId = current.category?.id ?? "";
  const nextCategoryId = next.category?.id ?? "";
  if (currentCategoryId !== nextCategoryId) {
    patch.game_id = nextCategoryId;
  }
  if (!sameTags(current.tags, next.tags)) {
    patch.tags = [...next.tags];
  }
  return patch;
}

export function changedFields(patch: StreamInfoPatch): Array<"title" | "category" | "tags"> {
  const fields: Array<"title" | "category" | "tags"> = [];
  if (patch.title !== undefined) {
    fields.push("title");
  }
  if (patch.game_id !== undefined) {
    fields.push("category");
  }
  if (patch.tags !== undefined) {
    fields.push("tags");
  }
  return fields;
}

export function isEmptyPatch(patch: StreamInfoPatch): boolean {
  return changedFields(patch).length === 0;
}

/**
 * Helix hands box art as a template with `{width}` and `{height}`
 * placeholders. Search Categories already fills them in (at 52x72); this
 * resizes either shape to what the widget draws, keeping Twitch's 3:4 ratio.
 */
export function sizedBoxArtUrl(url: string, width: number, height: number): string {
  return url
    .replace("{width}", String(width))
    .replace("{height}", String(height))
    .replace(/-\d+x\d+(\.\w+)$/, `-${width}x${height}$1`);
}

export const BOX_ART_WIDTH = 52;
export const BOX_ART_HEIGHT = 72;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function firstRow(body: unknown): Record<string, unknown> | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== "object" || data[0] === null) {
    return null;
  }
  return data[0] as Record<string, unknown>;
}

/**
 * The channel from a Get Channel Information response, without box art: that
 * endpoint returns only the category's id and name, so the art is a second
 * lookup. Null when Twitch returned no channel.
 */
export function channelInfoFromHelix(body: unknown): StreamInfo | null {
  const row = firstRow(body);
  if (!row) {
    return null;
  }
  const gameId = asString(row.game_id) ?? "";
  const gameName = asString(row.game_name) ?? "";
  const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [];
  return {
    title: asString(row.title) ?? "",
    category: gameId ? { id: gameId, name: gameName } : null,
    tags,
  };
}

/** Categories from a Search Categories or Get Games response, box art sized for the widget. */
export function categoriesFromHelix(body: unknown): StreamCategory[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  const categories: StreamCategory[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const id = asString(row.id);
    const name = asString(row.name);
    if (!id || !name) {
      continue;
    }
    const art = asString(row.box_art_url);
    categories.push({
      id,
      name,
      boxArtUrl: art ? sizedBoxArtUrl(art, BOX_ART_WIDTH, BOX_ART_HEIGHT) : undefined,
    });
  }
  return categories;
}
