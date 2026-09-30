/**
 * Search and ranking for the quick actions palette (⌘K), kept free of React so it can be
 * tested on its own. The palette component builds entries from the nav, the instance's
 * data and the actions it can run; everything here decides which of them to show, and in
 * what order.
 */

/** What an entry does when chosen, which is also what a scope prefix narrows the list to. */
export type PaletteKind = "page" | "action" | "item";

export type PaletteScope = "all" | PaletteKind;

/** Typed first, a prefix narrows the search to one kind — the same convention editors use. */
export const SCOPE_PREFIXES: ReadonlyArray<{ prefix: string; scope: PaletteKind; label: string }> = [
  { prefix: ">", scope: "action", label: "Actions" },
  { prefix: "/", scope: "page", label: "Pages" },
  { prefix: "#", scope: "item", label: "Items" },
];

export interface PaletteEntry {
  /** Stable across sessions: it is what the recent list remembers. */
  id: string;
  title: string;
  kind: PaletteKind;
  /** Heading the entry is listed under. */
  group: string;
  subtitle?: string;
  /** Other words someone might type for this entry. Match less strongly than the title. */
  keywords?: readonly string[];
  /** Added to the match score, e.g. for actions about the page that is open. */
  boost?: number;
  /**
   * Left out until something is typed (unless it is recent). Set on the actions nested
   * under an item, which would bury the list if all shown at once but should still be
   * reachable in one step: "reset deaths" runs without opening Deaths first.
   */
  hiddenUntilSearch?: boolean;
}

export interface ParsedQuery {
  scope: PaletteScope;
  text: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trimStart();
  const match = SCOPE_PREFIXES.find(({ prefix }) => trimmed.startsWith(prefix));
  if (!match) {
    return { scope: "all", text: trimmed.trim() };
  }
  return { scope: match.scope, text: trimmed.slice(match.prefix.length).trim() };
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function words(value: string): string[] {
  return value.split(/[^a-z0-9!]+/).filter((word) => word.length > 0);
}

/**
 * Whether `needle`'s characters appear in `haystack` in order. Scored by how tightly they
 * cluster and whether they land on word starts, so "nw" finds "New workflow" ahead of a
 * title that merely contains an n and later a w.
 */
function subsequenceScore(haystack: string, needle: string): number {
  let position = 0;
  let score = 0;
  let previous = -2;
  for (const char of needle) {
    const found = haystack.indexOf(char, position);
    if (found === -1) {
      return 0;
    }
    const atWordStart = found === 0 || /[^a-z0-9]/.test(haystack[found - 1]);
    if (atWordStart) {
      score += 12;
    }
    if (found === previous + 1) {
      score += 8;
    }
    score += 2;
    previous = found;
    position = found + 1;
  }
  return score;
}

/** How well one piece of text matches the query; 0 means it does not match at all. */
function textScore(text: string, query: string): number {
  if (text === query) {
    return 1000;
  }
  if (text.startsWith(query)) {
    return 800 - Math.min(text.length - query.length, 100);
  }
  if (words(text).some((word) => word.startsWith(query))) {
    return 600;
  }
  if (text.includes(query)) {
    return 400;
  }
  const fuzzy = subsequenceScore(text, query);
  // Below this the characters are scattered too widely to be what anyone meant.
  if (fuzzy < query.length * 8) {
    return 0;
  }
  return Math.min(100 + fuzzy, 350);
}

const KEYWORD_WEIGHT = 0.7;
const SUBTITLE_WEIGHT = 0.4;

function wholeQueryScore(entry: PaletteEntry, query: string): number {
  const title = textScore(normalize(entry.title), query);
  const keyword = Math.max(0, ...(entry.keywords ?? []).map((k) => textScore(normalize(k), query))) * KEYWORD_WEIGHT;
  const subtitle = entry.subtitle ? textScore(normalize(entry.subtitle), query) * SUBTITLE_WEIGHT : 0;
  return Math.max(title, keyword, subtitle);
}

/**
 * Every word of the query must be found somewhere on the entry, in any order: "reset
 * deaths" finds the Reset action on the Deaths counter though neither piece holds both.
 */
function tokenScore(entry: PaletteEntry, tokens: string[]): number {
  const title = normalize(entry.title);
  const rest = normalize([entry.subtitle ?? "", ...(entry.keywords ?? []), entry.group].join(" "));
  let score = 0;
  for (const token of tokens) {
    const inTitle = words(title).some((word) => word.startsWith(token)) || title.includes(token);
    if (inTitle) {
      score += 60;
      continue;
    }
    const inRest = words(rest).some((word) => word.startsWith(token)) || rest.includes(token);
    if (!inRest) {
      return 0;
    }
    score += 30;
  }
  return 200 + score / tokens.length;
}

/** How well the entry matches the (already scope-stripped) query; 0 means leave it out. */
export function scoreEntry(entry: PaletteEntry, text: string): number {
  const query = normalize(text.trim());
  if (query.length === 0) {
    return 1 + (entry.boost ?? 0);
  }
  const whole = wholeQueryScore(entry, query);
  const tokens = query.split(/\s+/);
  const byToken = tokens.length > 1 ? tokenScore(entry, tokens) : 0;
  const best = Math.max(whole, byToken);
  if (best === 0) {
    return 0;
  }
  return best + (entry.boost ?? 0);
}

export interface PaletteSection<T extends PaletteEntry> {
  heading: string;
  entries: T[];
}

export interface RankOptions {
  /** Ids most recent first. Shown as their own section while the query is empty. */
  recentIds?: readonly string[];
  /** Cap per heading while searching, so one long list cannot bury the others. */
  limitPerGroup?: number;
  /** Kinds hidden while the query is empty, where listing every one would be noise. */
  hideWhenEmpty?: readonly PaletteKind[];
}

export const RECENT_HEADING = "Recent";

/**
 * Filters and orders entries for display. With a query, sections are ordered by their best
 * match so the likeliest answer is always at the top; with none, recents lead and the
 * sections keep the order the entries were given in.
 */
export function rankEntries<T extends PaletteEntry>(
  entries: readonly T[],
  raw: string,
  options: RankOptions = {}
): PaletteSection<T>[] {
  const { scope, text } = parseQuery(raw);
  const inScope = scope === "all" ? entries : entries.filter((entry) => entry.kind === scope);
  const searching = text.length > 0;

  if (!searching) {
    return emptyQuerySections(inScope, scope, options);
  }

  const limit = options.limitPerGroup ?? Number.POSITIVE_INFINITY;
  const scored = inScope
    .map((entry) => ({ entry, score: scoreEntry(entry, text) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const sections = new Map<string, { best: number; entries: T[] }>();
  for (const { entry, score } of scored) {
    const section = sections.get(entry.group) ?? { best: score, entries: [] };
    if (section.entries.length < limit) {
      section.entries.push(entry);
    }
    sections.set(entry.group, section);
  }
  return [...sections.entries()]
    .sort(([, a], [, b]) => b.best - a.best)
    .map(([heading, section]) => ({ heading, entries: section.entries }));
}

function emptyQuerySections<T extends PaletteEntry>(
  entries: readonly T[],
  scope: PaletteScope,
  options: RankOptions
): PaletteSection<T>[] {
  const hidden = new Set(scope === "all" ? (options.hideWhenEmpty ?? []) : []);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const recent = scope === "all" ? (options.recentIds ?? []) : [];
  const recentEntries = recent.map((id) => byId.get(id)).filter((entry): entry is T => entry !== undefined);
  const shownAsRecent = new Set(recentEntries.map((entry) => entry.id));

  const sections: PaletteSection<T>[] = [];
  if (recentEntries.length > 0) {
    sections.push({ heading: RECENT_HEADING, entries: recentEntries });
  }
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    if (hidden.has(entry.kind) || entry.hiddenUntilSearch || shownAsRecent.has(entry.id)) {
      continue;
    }
    const list = grouped.get(entry.group) ?? [];
    list.push(entry);
    grouped.set(entry.group, list);
  }
  for (const [heading, list] of grouped) {
    // A boost marks what matters on the open page; keep those at the top of their section.
    const ordered = [...list].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0));
    sections.push({ heading, entries: ordered });
  }
  return sections;
}

export const MAX_RECENTS = 8;

/** The recent list after choosing `id`: moved to the front, without duplicates, capped. */
export function pushRecent(recentIds: readonly string[], id: string, max = MAX_RECENTS): string[] {
  return [id, ...recentIds.filter((existing) => existing !== id)].slice(0, max);
}

/**
 * The argument typed after one of a prompt's aliases, so "so ninja" can offer "Shout out
 * ninja" straight from the root list. Longest alias wins, so "shout out ninja" is not read
 * as "shout" with the argument "out ninja". Null when no alias leads the query or nothing
 * follows it.
 */
export function inlineArgument(query: string, aliases: readonly string[]): string | null {
  const normalized = query.trimStart();
  const lower = normalized.toLowerCase();
  const byLength = [...aliases].sort((a, b) => b.length - a.length);
  for (const alias of byLength) {
    const prefix = `${alias.toLowerCase()} `;
    if (!lower.startsWith(prefix)) {
      continue;
    }
    const argument = normalized.slice(prefix.length).trim();
    return argument.length > 0 ? argument : null;
  }
  return null;
}
