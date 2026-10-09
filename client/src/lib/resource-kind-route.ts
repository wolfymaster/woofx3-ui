import { COUNTER_KIND, QUEUE_KIND, TIMER_KIND } from "@convex/lib/resourceKinds";

/** Where a kind other than the built-in ones lives: `<base>/<module>/<kind>`. */
export const RESOURCE_KINDS_BASE = "/stream/resources";

/**
 * The woofx3 module's kinds, at the addresses they have always had, and listed
 * in the menu and the palette by hand. Their pages are the same as any kind's.
 */
const BUILT_IN_KIND_PATHS: Readonly<Record<string, string>> = {
  [COUNTER_KIND]: "/stream/counters",
  [TIMER_KIND]: "/stream/timers",
  [QUEUE_KIND]: "/stream/queues",
};

/** Whether a kind is one of the built-in ones, which the menu and the palette list already. */
export function isBuiltInKind(moduleName: string, kind: string): boolean {
  return `${moduleName}:${kind}` in BUILT_IN_KIND_PATHS;
}

/** Each built-in kind and the address its page is routed at. */
export function builtInKindRoutes(): { moduleName: string; kind: string; path: string }[] {
  return Object.entries(BUILT_IN_KIND_PATHS).map(([qualified, path]) => {
    const [moduleName, kind] = qualified.split(":");
    return { moduleName, kind, path };
  });
}

/** The page that lists a kind's instances; an instance lives one segment below it. */
export function resourceKindPath(moduleName: string, kind: string): string {
  return (
    BUILT_IN_KIND_PATHS[`${moduleName}:${kind}`] ??
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
