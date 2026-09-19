import type { LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { CircleHelp } from "lucide-react";

const iconMap = LucideIcons as unknown as Record<string, LucideIcon | undefined>;

export function resolveLucideIcon(name: string): LucideIcon {
  const Icon = iconMap[name];
  if (typeof Icon === "function") {
    return Icon;
  }
  return CircleHelp;
}

const ICON_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

let cachedNames: string[] | null = null;

/**
 * Every selectable Lucide icon name, sorted. lucide-react also exports helpers
 * and, for each icon, `LucidePascalCase` and `PascalCaseIcon` aliases of the
 * same component — those are filtered out so a picker offers each icon once.
 * Computed on first call: the whole namespace is already in the bundle for
 * resolveLucideIcon, so this only walks keys.
 */
export function listLucideIconNames(): string[] {
  if (cachedNames) {
    return cachedNames;
  }
  cachedNames = Object.keys(iconMap)
    .filter(
      (name) =>
        ICON_NAME_PATTERN.test(name) &&
        !name.startsWith("Lucide") &&
        !name.endsWith("Icon") &&
        typeof iconMap[name] === "function"
    )
    .sort();
  return cachedNames;
}
