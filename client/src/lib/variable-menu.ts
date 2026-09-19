import type { VariableNames } from "@/lib/variable-display";
import type { VariableOption } from "@/lib/workflow-variables";

export interface VariableMenuItem {
  option: VariableOption;
  /** The short name the field shows and inserts, without braces. */
  name: string;
}

export interface VariableMenuGroup {
  group: string;
  items: VariableMenuItem[];
}

/**
 * The variables matching `query`, grouped by where they come from, best matches first.
 *
 * Only the name, the label and the group are searched. Descriptions and types are
 * left out: they are prose and type tokens, so a short query like "user" or "str"
 * would match nearly every row and bury the variable being typed.
 *
 * Groups keep their workflow order until a query ranks one ahead of another, so an
 * empty query reads trigger first, then each step in the order it runs.
 */
export function variableMenuGroups(
  options: readonly VariableOption[],
  names: VariableNames,
  query: string
): VariableMenuGroup[] {
  const q = query.trim().toLowerCase();
  const scored: { item: VariableMenuItem; score: number; order: number }[] = [];
  options.forEach((option, order) => {
    const name = names.nameByToken.get(option.value) ?? option.value;
    const score = matchScore(q, name, option);
    if (score !== null) {
      scored.push({ item: { option, name }, score, order });
    }
  });

  const byGroup = new Map<string, { best: number; order: number; entries: typeof scored }>();
  for (const entry of scored) {
    const existing = byGroup.get(entry.item.option.group);
    if (existing) {
      existing.best = Math.min(existing.best, entry.score);
      existing.entries.push(entry);
    } else {
      byGroup.set(entry.item.option.group, { best: entry.score, order: entry.order, entries: [entry] });
    }
  }

  return Array.from(byGroup.entries())
    .sort(([, a], [, b]) => a.best - b.best || a.order - b.order)
    .map(([group, { entries }]) => ({
      group,
      items: entries.sort((a, b) => a.score - b.score || a.order - b.order).map((entry) => entry.item),
    }));
}

/** Lower is better; null when the option does not match at all. */
function matchScore(q: string, name: string, option: VariableOption): number | null {
  if (!q) {
    return 0;
  }
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith(q)) {
    return 0;
  }
  if (lowerName.includes(q)) {
    return 1;
  }
  if (option.label.toLowerCase().includes(q)) {
    return 2;
  }
  if (option.group.toLowerCase().includes(q)) {
    return 3;
  }
  return null;
}

/** The menu's items in the order they are shown, which is the order the arrow keys walk. */
export function flattenVariableMenu(groups: readonly VariableMenuGroup[]): VariableMenuItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * `text` with the range `start`..`end` replaced by a `{name}` reference, and where the
 * cursor belongs afterwards: just past the inserted reference.
 */
export function insertVariableReference(
  text: string,
  start: number,
  end: number,
  name: string
): { text: string; cursor: number } {
  if (start < 0 || end < start || end > text.length) {
    throw new Error(`insert range ${start}..${end} is outside text of length ${text.length}`);
  }
  const reference = `{${name}}`;
  return { text: `${text.slice(0, start)}${reference}${text.slice(end)}`, cursor: start + reference.length };
}
