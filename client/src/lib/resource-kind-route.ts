import { COUNTER_KIND, QUEUE_KIND, TIMER_KIND } from "@convex/lib/resourceKinds";

/** Where a resource kind without a page of its own lives: `<base>/<module>/<kind>`. */
export const RESOURCE_KINDS_BASE = "/stream/resources";

/** The kinds with a first-party page, at the address each has always had. */
const FIRST_PARTY_KIND_PATHS: Readonly<Record<string, string>> = {
  [COUNTER_KIND]: "/stream/counters",
  [TIMER_KIND]: "/stream/timers",
  [QUEUE_KIND]: "/stream/queues",
};

/** Whether a kind has a first-party page, which the menu already lists. */
export function hasFirstPartyPage(moduleName: string, kind: string): boolean {
  return `${moduleName}:${kind}` in FIRST_PARTY_KIND_PATHS;
}

/** The page that lists a kind's instances; an instance lives one segment below it. */
export function resourceKindPath(moduleName: string, kind: string): string {
  return (
    FIRST_PARTY_KIND_PATHS[`${moduleName}:${kind}`] ??
    `${RESOURCE_KINDS_BASE}/${encodeURIComponent(moduleName)}/${encodeURIComponent(kind)}`
  );
}

/**
 * The plural of a kind's display name, for a menu entry or a page title: a
 * manifest gives only the singular ("Wheel"). English rules only, since every
 * other label in the menu is English too.
 */
export function pluralKindName(name: string): string {
  if (/[^aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/i.test(name)) {
    return `${name}es`;
  }
  return `${name}s`;
}
