import { MAX_SLUG_LENGTH, suggestSlug } from "@shared/engine-slug";

/**
 * What a new account is called until connecting Twitch names it. A name still
 * equal to this is how renaming knows the user has not chosen their own.
 */
export const PLACEHOLDER_NAME = "My woofx3";

export interface FirstRunNames {
  account: string;
  instance: string;
  user: string | undefined;
}

/**
 * The names to change once Twitch tells us who the streamer is: only those
 * still on the placeholder, or a user with no name at all.
 */
export function linkedNames(current: FirstRunNames, displayName: string): Partial<FirstRunNames> {
  const display = displayName.trim();
  if (display === "") {
    return {};
  }
  return {
    ...(current.account === PLACEHOLDER_NAME ? { account: display } : {}),
    ...(current.instance === PLACEHOLDER_NAME ? { instance: `${display}'s Instance` } : {}),
    ...(current.user?.trim() ? {} : { user: display }),
  };
}

const SLUG_SUFFIXES = ["", "-tv", "-live", "-2", "-3", "-4", "-5"];

/** The maintenance API reserves whole prefixes, which no suffix gets around. */
const SLUG_PREFIX = "tv-";

/**
 * The usernames to try for a Twitch login, best first, each within the length
 * limit. Empty when nothing usable survives, such as a login of only
 * underscores. Only the login feeds this, never an email: a username is public
 * and permanent, and a login is already public.
 */
export function slugCandidates(login: string | null): string[] {
  const base = login === null ? "" : suggestSlug(login);
  if (base === "") {
    return [];
  }
  const fit = (text: string, length: number) => text.slice(0, length).replace(/-+$/, "");
  return [
    ...SLUG_SUFFIXES.map((suffix) => `${fit(base, MAX_SLUG_LENGTH - suffix.length)}${suffix}`),
    fit(`${SLUG_PREFIX}${base}`, MAX_SLUG_LENGTH),
  ];
}
