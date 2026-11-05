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

/**
 * How long a row stays `requested` before another request may take it over.
 * Outlasts the action asking the maintenance API, so two requests cannot race
 * for one row; a request that died leaves the row usable after this.
 */
export const REQUEST_IN_FLIGHT_MS = 15 * 60 * 1000;

/** How long a finished setup may have no provisioning row: the scheduled request makes one within seconds. */
export const ENGINE_REQUEST_GRACE_MS = 2 * 60 * 1000;

export interface EngineBuildFacts {
  provisioning: { status: string; updatedAt: number } | null;
  /** False for an engine the user runs themselves, which nothing here builds. */
  managedEngine: boolean;
  completedAt: number | null;
  now: number;
}

/**
 * Whether an unregistered instance's build has stopped, so waiting on it would
 * be waiting forever and the screens offer Try again instead. A dead request
 * leaves no failure behind: only a row stuck on `requested`, or no row at all.
 */
export function engineBuildStalled({ provisioning, managedEngine, completedAt, now }: EngineBuildFacts): boolean {
  if (provisioning) {
    return (
      provisioning.status === "failed" ||
      (provisioning.status === "requested" && now - provisioning.updatedAt >= REQUEST_IN_FLIGHT_MS)
    );
  }
  if (!managedEngine) {
    return true;
  }
  return completedAt === null || now - completedAt >= ENGINE_REQUEST_GRACE_MS;
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
