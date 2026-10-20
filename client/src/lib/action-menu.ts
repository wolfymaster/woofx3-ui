import { taxonomyLabel } from "@/lib/alert-groups";
import type { ActionPreset } from "@/lib/workflow-presets";

/**
 * The group an action belongs to when it names no module: the actions the engine
 * itself provides. Mirrors the Convex-side label so both catalogs read the same.
 */
export const BUILTIN_MODULE_LABEL = "Built-in";

/**
 * The family of the primitives every workflow is built from (Function, Print). Its
 * section leads the menu instead of sorting under "w".
 */
const WORKFLOW_SECTION_KEY = "taxonomy:workflow";

/**
 * The family engines before purpose-based taxonomy filed every bundled action under,
 * and the section a built-in action declaring no taxonomy lands in. It leads too, so
 * an older engine's catalog keeps the primitives on top.
 */
const SYSTEM_FAMILY = "system";
const SYSTEM_SECTION_KEY = `taxonomy:${SYSTEM_FAMILY}`;

const LEADING_SECTIONS = new Set([WORKFLOW_SECTION_KEY, SYSTEM_SECTION_KEY]);

/**
 * Section labels for taxonomy families, where the family name alone reads wrong as a
 * heading over many entries. A phrase the UI owns; any other family is humanised.
 */
const FAMILY_LABELS: Record<string, string> = {
  [SYSTEM_FAMILY]: BUILTIN_MODULE_LABEL,
  platform: "Platforms",
  overlay: "Overlays",
  tools: "Stream tools",
};

/** Where an action is listed: a section and a heading inside it. */
export interface ActionPlacement {
  sectionKey: string;
  sectionLabel: string;
  groupKey: string;
  /** Equal to `sectionLabel` when the section has no headings of its own. */
  groupLabel: string;
}

export interface ActionMenuGroup extends ActionPlacement {
  actions: ActionPreset[];
}

/**
 * Where an action is listed, read from its first `taxonomy` entry: the first
 * segment is the section, the second the heading inside it (`platform.obs` lists
 * under Platforms › OBS). An entry of one segment is a section with no headings.
 *
 * An action declaring no taxonomy, or a malformed first entry, is listed under the
 * module providing it, so a catalog from an engine that sends no taxonomy reads as
 * one section per module. Only the first entry counts: further entries are
 * independent axes, not a second place to list the action.
 */
export function actionPlacement(preset: Pick<ActionPreset, "source" | "taxonomy">): ActionPlacement {
  const segments = firstTaxonomySegments(preset.taxonomy);
  if (!segments) {
    if (preset.source === BUILTIN_MODULE_LABEL) {
      return sectionOnly(SYSTEM_SECTION_KEY, BUILTIN_MODULE_LABEL);
    }
    return sectionOnly(`module:${preset.source}`, preset.source);
  }
  const [family, heading] = segments;
  const sectionKey = `taxonomy:${family}`;
  const sectionLabel = FAMILY_LABELS[family] ?? taxonomyLabel(family);
  if (heading === undefined) {
    return sectionOnly(sectionKey, sectionLabel);
  }
  return { sectionKey, sectionLabel, groupKey: `${sectionKey}.${heading}`, groupLabel: taxonomyLabel(heading) };
}

/**
 * The actions matching `query`, grouped by placement, each section's groups together.
 *
 * With no query, sections, groups and the actions inside them read alphabetically, so
 * a list someone is browsing does not reorder itself between visits. A query ranks
 * instead: name first, then description, then where the action is listed or which
 * module provides it, and the section and group holding the best match lead.
 *
 * Workflow primitives lead either way; see WORKFLOW_SECTION_KEY.
 */
export function actionMenuGroups(presets: readonly ActionPreset[], query: string): ActionMenuGroup[] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, { placement: ActionPlacement; best: number; entries: ScoredAction[] }>();
  const sectionBest = new Map<string, number>();

  for (const preset of presets) {
    const placement = actionPlacement(preset);
    const score = matchScore(q, preset, placement);
    if (score === null) {
      continue;
    }
    sectionBest.set(placement.sectionKey, Math.min(sectionBest.get(placement.sectionKey) ?? score, score));
    const group = groups.get(placement.groupKey);
    if (group) {
      group.best = Math.min(group.best, score);
      group.entries.push({ preset, score });
    } else {
      groups.set(placement.groupKey, { placement, best: score, entries: [{ preset, score }] });
    }
  }

  const sectionRank = (key: string) => sectionBest.get(key) ?? 0;
  return Array.from(groups.values())
    .sort((a, b) => {
      const aSection = a.placement.sectionKey;
      const bSection = b.placement.sectionKey;
      if (aSection !== bSection) {
        const aLeads = LEADING_SECTIONS.has(aSection);
        const bLeads = LEADING_SECTIONS.has(bSection);
        if (aLeads !== bLeads) {
          return aLeads ? -1 : 1;
        }
        return (
          sectionRank(aSection) - sectionRank(bSection) ||
          a.placement.sectionLabel.localeCompare(b.placement.sectionLabel) ||
          aSection.localeCompare(bSection)
        );
      }
      return (
        a.best - b.best ||
        a.placement.groupLabel.localeCompare(b.placement.groupLabel) ||
        a.placement.groupKey.localeCompare(b.placement.groupKey)
      );
    })
    .map((group) => ({
      ...group.placement,
      actions: group.entries
        .sort((a, b) => a.score - b.score || a.preset.name.localeCompare(b.preset.name))
        .map((entry) => entry.preset),
    }));
}

/**
 * The heading over a group. A section's first group names the section and its own
 * heading (Stream tools › Counters), or the section alone when the group has no
 * heading of its own (a module's section, or a one-segment taxonomy); later groups
 * name their own heading.
 */
export function actionGroupHeading(group: ActionMenuGroup, previous: ActionMenuGroup | undefined): string {
  if (previous?.sectionKey === group.sectionKey) {
    return group.groupLabel;
  }
  return group.groupLabel !== group.sectionLabel ? `${group.sectionLabel} › ${group.groupLabel}` : group.sectionLabel;
}

interface ScoredAction {
  preset: ActionPreset;
  score: number;
}

function sectionOnly(key: string, label: string): ActionPlacement {
  return { sectionKey: key, sectionLabel: label, groupKey: key, groupLabel: label };
}

/** The first entry's segments, or `undefined` when there is none or it is malformed (`platform.`, `a..b`). */
function firstTaxonomySegments(taxonomy: readonly string[] | undefined): string[] | undefined {
  const first = taxonomy?.find((entry) => entry.trim() !== "");
  if (!first) {
    return undefined;
  }
  const segments = first.split(".").map((segment) => segment.trim());
  return segments.every((segment) => segment.length > 0) ? segments : undefined;
}

/** Lower is better; null when the action does not match at all. */
function matchScore(q: string, preset: ActionPreset, placement: ActionPlacement): number | null {
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
  const where = [placement.sectionLabel, placement.groupLabel, preset.source];
  if (where.some((label) => label.toLowerCase().includes(q))) {
    return 3;
  }
  return null;
}
