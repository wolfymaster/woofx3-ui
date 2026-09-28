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

// Twitch's documented rule is "no spaces or special characters", and its own
// validation is the authority: a tag this pattern flags is only warned about,
// never refused, so a tag Twitch would take is never blocked here. Marks (\p{M})
// are included because Devanagari, Tamil and similar scripts need combining
// vowel signs to spell a word at all.
// biome-ignore lint/complexity/useRegexLiterals: the client TypeScript target predates the `u` literal flag
const TAG_PATTERN = new RegExp("^[\\p{L}\\p{M}\\p{N}]+$", "u");

/** Only Twitch's CDN serves box art; anything else in a preset row is refused. */
export const BOX_ART_URL_PREFIX = "https://static-cdn.jtvnw.net/";
/** Twitch category ids are short numeric strings; this bounds what a preset row may hold. */
export const MAX_CATEGORY_ID_LENGTH = 32;
export const MAX_CATEGORY_NAME_LENGTH = 200;
export const MAX_BOX_ART_URL_LENGTH = 500;

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

/**
 * Why a single tag cannot be used, or null. These are the rules Twitch states
 * plainly and the backend enforces; character-class doubts are `tagWarning`.
 */
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
  return null;
}

/** Advice about a tag Twitch will probably refuse, shown but not enforced. */
export function tagWarning(tag: string): string | null {
  if (tag.length === 0 || TAG_PATTERN.test(tag)) {
    return null;
  }
  return "Twitch usually refuses punctuation and symbols in tags";
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

/**
 * Why a category cannot be stored or sent, or null. Twitch category ids are
 * numeric; box art must come from Twitch's CDN, because a preset row's URL is
 * rendered as an image for everyone on the account.
 */
export function categoryProblem(category: StreamCategory): string | null {
  if (!/^\d+$/.test(category.id) || category.id.length > MAX_CATEGORY_ID_LENGTH) {
    return "That isn't a Twitch category";
  }
  const nameLength = characterCount(category.name);
  if (nameLength === 0 || nameLength > MAX_CATEGORY_NAME_LENGTH) {
    return "That category has no usable name";
  }
  if (category.boxArtUrl !== undefined) {
    if (category.boxArtUrl.length > MAX_BOX_ART_URL_LENGTH || !category.boxArtUrl.startsWith(BOX_ART_URL_PREFIX)) {
      return "Category art must come from Twitch";
    }
  }
  return null;
}

export function markerDescriptionProblem(description: string): string | null {
  if (characterCount(description) > MAX_MARKER_DESCRIPTION_LENGTH) {
    return `Marker descriptions are limited to ${MAX_MARKER_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}

/**
 * Tags compare as a set, since order is not something a viewer can see, but
 * case-sensitively: "fps" to "FPS" is a deliberate edit and must be saveable.
 */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) {
    return false;
  }
  return Array.from(right).every((tag) => left.has(tag));
}

export type StreamInfoField = "title" | "category" | "tags";

/** Some of a channel's fields; a present `category: null` means "clear it". */
export type StreamInfoChanges = Partial<StreamInfo>;

/**
 * The fields of `next` that differ from `base`. Only these are sent to
 * Twitch: re-sending a field the editor never touched would revert whatever
 * changed it elsewhere since `base` was read (Twitch's dashboard, a moderator,
 * a chat command). Category compares by id alone; its name and art are display.
 */
export function diffStreamInfo(base: StreamInfo, next: StreamInfo): StreamInfoChanges {
  const changes: StreamInfoChanges = {};
  if (base.title !== next.title) {
    changes.title = next.title;
  }
  if ((base.category?.id ?? "") !== (next.category?.id ?? "")) {
    changes.category = next.category;
  }
  if (!sameTags(base.tags, next.tags)) {
    changes.tags = [...next.tags];
  }
  return changes;
}

export function changedFields(changes: StreamInfoChanges): StreamInfoField[] {
  const fields: StreamInfoField[] = [];
  if (changes.title !== undefined) {
    fields.push("title");
  }
  if (changes.category !== undefined) {
    fields.push("category");
  }
  if (changes.tags !== undefined) {
    fields.push("tags");
  }
  return fields;
}

export function isEmptyChanges(changes: StreamInfoChanges): boolean {
  return changedFields(changes).length === 0;
}

/** A Modify Channel Information body. */
export interface StreamInfoPatch {
  title?: string;
  game_id?: string;
  tags?: string[];
}

/** `changes` in Helix's shape. A cleared category is an empty `game_id`. */
export function toHelixPatch(changes: StreamInfoChanges): StreamInfoPatch {
  const patch: StreamInfoPatch = {};
  if (changes.title !== undefined) {
    patch.title = changes.title;
  }
  if (changes.category !== undefined) {
    patch.game_id = changes.category?.id ?? "";
  }
  if (changes.tags !== undefined) {
    patch.tags = [...changes.tags];
  }
  return patch;
}

/**
 * Requested fields Twitch does not hold after the write. Modify Channel
 * Information answers 204 even when it ignores a value (an unknown game id),
 * so success is judged by reading the channel back, not by the status.
 */
export function unappliedFields(requested: StreamInfoChanges, actual: StreamInfo): StreamInfoField[] {
  return changedFields(diffStreamInfo(actual, { ...actual, ...requested }));
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
