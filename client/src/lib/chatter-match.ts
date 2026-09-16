/**
 * Ranking for the shoutout autocomplete.
 *
 * The chatter roster is fetched once and filtered here on every keystroke, so
 * this runs far more often than it fetches -- and it is the part that decides
 * whether the right name is the first one you can hit Enter on. Kept pure so
 * the ranking can be tested without a chat.
 */

export interface ChatterOption {
  userId: string;
  login: string;
  displayName: string;
}

/** Lower sorts first. */
const RANK_LOGIN_PREFIX = 0;
const RANK_DISPLAY_PREFIX = 1;
const RANK_SUBSTRING = 2;

const DEFAULT_LIMIT = 8;

/** Twitch logins have no `@`, but people type it. */
function normalizeQuery(query: string): string {
  return query.trim().replace(/^@/, "").toLowerCase();
}

function rankOf(chatter: ChatterOption, query: string): number | null {
  const login = chatter.login.toLowerCase();
  const displayName = chatter.displayName.toLowerCase();

  if (login.startsWith(query)) {
    return RANK_LOGIN_PREFIX;
  }
  if (displayName.startsWith(query)) {
    return RANK_DISPLAY_PREFIX;
  }
  if (login.includes(query) || displayName.includes(query)) {
    return RANK_SUBSTRING;
  }
  return null;
}

/**
 * Chatters matching `query`, best first.
 *
 * A prefix match ranks above a substring match, and a login prefix above a
 * display-name prefix: typing the start of someone's name should surface them
 * before someone who merely contains those letters. Ties break alphabetically
 * so the list does not reshuffle as unrelated chatters come and go.
 *
 * An empty query returns the head of the roster alphabetically rather than
 * nothing, so opening the field shows who is actually here.
 */
export function matchChatters(
  chatters: readonly ChatterOption[],
  query: string,
  limit: number = DEFAULT_LIMIT
): ChatterOption[] {
  const needle = normalizeQuery(query);

  if (!needle) {
    return [...chatters].sort((a, b) => a.login.localeCompare(b.login)).slice(0, limit);
  }

  const ranked: Array<{ chatter: ChatterOption; rank: number }> = [];
  for (const chatter of chatters) {
    const rank = rankOf(chatter, needle);
    if (rank !== null) {
      ranked.push({ chatter, rank });
    }
  }

  ranked.sort((a, b) => a.rank - b.rank || a.chatter.login.localeCompare(b.chatter.login));
  return ranked.slice(0, limit).map((entry) => entry.chatter);
}
