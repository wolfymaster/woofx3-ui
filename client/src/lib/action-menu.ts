import type { ActionPreset } from "@/lib/workflow-presets";

/**
 * The group an action belongs to when it names no module: the actions the engine
 * itself provides. Mirrors the Convex-side label so both catalogs read the same.
 */
export const BUILTIN_MODULE_LABEL = "Built-in";

/** The rail entry that narrows to nothing, shown as "All actions". */
export const ALL_SOURCES = "__all__";

/**
 * Actions the workflow engine provides rather than a platform integration. They are
 * the primitives every workflow is built from — Alert, Function, Print — so their
 * group leads the menu instead of sorting under "w".
 */
const SYSTEM_AXIS = "system.workflow";

export interface ActionMenuGroup {
  source: string;
  actions: ActionPreset[];
}

export interface ActionSourceCount {
  source: string;
  count: number;
}

/**
 * The actions matching `query`, grouped by the module providing them.
 *
 * With no query, groups and the actions inside them read alphabetically, so a list
 * someone is browsing does not reorder itself between visits. A query ranks instead:
 * name first, then description, then the module's name, and the group holding the
 * best match leads.
 *
 * System actions lead either way; see SYSTEM_AXIS.
 */
export function actionMenuGroups(
  presets: readonly ActionPreset[],
  query: string,
  source: string = ALL_SOURCES
): ActionMenuGroup[] {
  const q = query.trim().toLowerCase();
  const scored: { preset: ActionPreset; score: number }[] = [];
  for (const preset of presets) {
    if (source !== ALL_SOURCES && preset.source !== source) {
      continue;
    }
    const score = matchScore(q, preset);
    if (score !== null) {
      scored.push({ preset, score });
    }
  }

  const bySource = new Map<string, { best: number; isSystem: boolean; entries: typeof scored }>();
  for (const entry of scored) {
    const group = bySource.get(entry.preset.source);
    if (group) {
      group.best = Math.min(group.best, entry.score);
      group.isSystem = group.isSystem || isSystemAction(entry.preset);
      group.entries.push(entry);
    } else {
      bySource.set(entry.preset.source, {
        best: entry.score,
        isSystem: isSystemAction(entry.preset),
        entries: [entry],
      });
    }
  }

  return Array.from(bySource.entries())
    .sort(([aSource, a], [bSource, b]) => {
      if (a.isSystem !== b.isSystem) {
        return a.isSystem ? -1 : 1;
      }
      return a.best - b.best || aSource.localeCompare(bSource);
    })
    .map(([groupSource, group]) => ({
      source: groupSource,
      actions: group.entries
        .sort((a, b) => a.score - b.score || a.preset.name.localeCompare(b.preset.name))
        .map((entry) => entry.preset),
    }));
}

/**
 * How many actions each module offers for `query`, in the order the groups appear,
 * for the picker's rail. Counts ignore which source is selected, so the rail keeps
 * showing where else a search has hits.
 */
export function actionSourceCounts(presets: readonly ActionPreset[], query: string): ActionSourceCount[] {
  return actionMenuGroups(presets, query).map((group) => ({ source: group.source, count: group.actions.length }));
}

/** The menu's actions in the order shown, which is the order the arrow keys walk. */
export function flattenActionMenu(groups: readonly ActionMenuGroup[]): ActionPreset[] {
  return groups.flatMap((group) => group.actions);
}

function isSystemAction(preset: ActionPreset): boolean {
  return preset.taxonomy?.includes(SYSTEM_AXIS) ?? false;
}

/** Lower is better; null when the action does not match at all. */
function matchScore(q: string, preset: ActionPreset): number | null {
  if (!q) {
    return 0;
  }
  const name = preset.name.toLowerCase();
  if (name.startsWith(q)) {
    return 0;
  }
  if (name.includes(q)) {
    return 1;
  }
  if (preset.description.toLowerCase().includes(q)) {
    return 2;
  }
  if (preset.source.toLowerCase().includes(q)) {
    return 3;
  }
  return null;
}
