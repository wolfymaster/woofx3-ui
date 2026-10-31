// The rules every store of a macro pad keeps: what a button must hold to be
// saved, and how the pad's order is kept as one `sortOrder` per button.

import type { MacroActionType, MacroConfig } from "./macro-variables";

/** A macro's stored fields, whichever store keeps them. */
export interface MacroFields {
  label: string;
  /** Lucide icon name. */
  icon?: string;
  /** Six-digit hex (`#rrggbb`). Undefined leaves the tile in the default card style. */
  color?: string;
  type: MacroActionType;
  config: MacroConfig;
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Exactly `#rrggbb`. The tile's background wash is built by appending an alpha
 * pair to the stored value, which only produces a valid color for the six-digit
 * form, so anything else is refused rather than rendering as a broken style.
 */
export function isHexColor(value: string | undefined): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

/** Why `fields` cannot be stored, or null when they can. */
export function macroFieldsProblem(fields: MacroFields): string | null {
  if (fields.label.trim() === "") {
    return "A macro needs a label";
  }
  if (fields.color !== undefined && !isHexColor(fields.color)) {
    return "A macro's color must be a six-digit hex color such as #3b82f6";
  }
  return null;
}

/** The `sortOrder` that places a new macro after every one in `sortOrders`. */
export function nextMacroSortOrder(sortOrders: Iterable<number>): number {
  let last = -1;
  for (const sortOrder of sortOrders) {
    last = Math.max(last, sortOrder);
  }
  return last + 1;
}

/**
 * The writes that give the macros in `order` their positions as `sortOrder`,
 * leaving out those already there. An id `current` lacks (a macro deleted
 * since the pad was drawn) is skipped rather than failing the reorder, and a
 * macro missing from `order` (added elsewhere since) keeps its order.
 */
export function macroOrderChanges<Id extends string>(
  order: readonly Id[],
  current: ReadonlyMap<Id, number>
): Array<{ id: Id; sortOrder: number }> {
  const changes: Array<{ id: Id; sortOrder: number }> = [];
  order.forEach((id, index) => {
    const sortOrder = current.get(id);
    if (sortOrder !== undefined && sortOrder !== index) {
      changes.push({ id, sortOrder: index });
    }
  });
  return changes;
}

/** Pad order: by `sortOrder`, ties (two writers placing at once) broken by id so every reader agrees. */
export function compareMacroOrder(a: { id: string; sortOrder: number }, b: { id: string; sortOrder: number }): number {
  return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
