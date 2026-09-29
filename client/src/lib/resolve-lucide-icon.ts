import type { LucideIcon } from "lucide-react";
import { dynamicLucideIcon, loadLucideCatalog } from "@/lib/dynamic-lucide-icon";
import { ICON_SET } from "@/lib/icon-set";

/**
 * Icon names are data (engine catalog rows, stored macro icons), so they are
 * resolved at runtime. Names in ICON_SET resolve to the bundled component;
 * any other name gets a component that loads that one icon on demand.
 */
export function resolveLucideIcon(name: string): LucideIcon {
  if (Object.hasOwn(ICON_SET, name)) {
    return ICON_SET[name];
  }
  return dynamicLucideIcon(name);
}

/** The names of ICON_SET, sorted: what can be offered without loading anything. */
export const BUNDLED_ICON_NAMES: readonly string[] = Object.keys(ICON_SET).sort();

/** Every selectable Lucide icon name, sorted. Loads the full Lucide catalog. */
export async function loadLucideIconNames(): Promise<readonly string[]> {
  return (await loadLucideCatalog()).names;
}
