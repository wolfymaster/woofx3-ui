/**
 * Ordering for chat command groups.
 *
 * The engine seeds built-in groups in a deliberate order (see
 * db/database/models/builtin_groups.go — "the canonical catalog, in display
 * order"), but that order is not carried on the wire: `listGroups` returns no
 * sort index, and the control plane's cache reads back in insertion order.
 * Today the two happen to agree because insertion followed the catalog; a
 * re-sync, or new built-ins, can silently diverge them.
 *
 * So the known catalog order is mirrored here. Built-in groups the client
 * hasn't heard of yet — follower and subscriber tiers are coming — sort after
 * the known ones alphabetically rather than being dropped or floated to the
 * top. If the engine ever publishes a sort index, delete this and use it.
 */
export const BUILT_IN_GROUP_ORDER = ["everyone", "subscriber", "vip", "moderator", "broadcaster"] as const;

interface OrderableGroup {
  name: string;
  isBuiltIn?: boolean;
}

function builtInRank(name: string): number {
  const index = BUILT_IN_GROUP_ORDER.indexOf(name as (typeof BUILT_IN_GROUP_ORDER)[number]);
  // Unknown built-ins sort after every known one, but still ahead of nothing —
  // they keep their alphabetical tie-break below.
  return index === -1 ? BUILT_IN_GROUP_ORDER.length : index;
}

/**
 * Built-in groups first in catalog order, then custom groups alphabetically.
 * Total and stable: equal ranks fall back to a case-insensitive name compare,
 * so the list never reshuffles between renders.
 */
export function compareGroups(a: OrderableGroup, b: OrderableGroup): number {
  const aBuiltIn = a.isBuiltIn ?? false;
  const bBuiltIn = b.isBuiltIn ?? false;
  if (aBuiltIn !== bBuiltIn) {
    return aBuiltIn ? -1 : 1;
  }
  if (aBuiltIn && bBuiltIn) {
    const rank = builtInRank(a.name) - builtInRank(b.name);
    if (rank !== 0) {
      return rank;
    }
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Sorts a copy — callers hold Convex query results, which must not be mutated. */
export function sortGroups<T extends OrderableGroup>(groups: readonly T[]): T[] {
  return [...groups].sort(compareGroups);
}
