import { taxonomyLabel, triggerMenuAxis } from "@/lib/taxonomy";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * The Alerts menu: platform first, then what happened.
 *
 * Both levels read the trigger's declared taxonomy rather than parsing its event
 * name. `platform.twitch` places it under Twitch; `alert.subscription.gift` places
 * it under Subscriptions › Gift, one menu level per segment, as deep as the module
 * author declares. A trigger that declares no platform goes under Other.
 *
 * A declared axis is used because an inferred one breaks on renames. This screen
 * once took the group from the event name's leading segment, which held only while
 * events read `{what}.{scope}.{platform}`; once they became `{scope}.{what}`
 * (`channel.follow`, `channel.cheer`), every channel event collapsed into one group.
 *
 * A trigger with no `alert.*` axis is not an alert type, so workflow and module
 * lifecycle triggers are never offered as things to alert on. A `platform.system`
 * trigger is not either: the resource it is about has its own page (Counters sits
 * under Data), so it is configured there rather than in the Alerts menu.
 */
export interface AlertNode {
  /**
   * Menu path from the platform down, e.g. `["twitch", "subscription", "gift"]`.
   * Joined with `/`, it is both the node's URL below the Alerts route and its id.
   */
  path: string[];
  label: string;
  /** Triggers whose taxonomy ends at exactly this node; see `subtreePresets` for the rest. */
  presets: TriggerPreset[];
  children: AlertNode[];
}

/** The platform node for triggers that declare no `platform.*` axis. */
export const OTHER_PLATFORM_KEY = "other";

const PLATFORM_AXIS_PREFIX = "platform.";
const ALERT_AXIS_PREFIX = "alert.";
/** Not a platform to group by: these triggers belong to a resource page, not Alerts. */
const SYSTEM_PLATFORM_KEY = "system";

/**
 * Where a trigger sits in the Alerts menu: its platform, then each `alert.*` segment.
 * `undefined` when the trigger is not an alert kind offered here.
 */
export function alertMenuPath(preset: Pick<TriggerPreset, "taxonomy">): string[] | undefined {
  const declaredPlatform = triggerMenuAxis(preset.taxonomy, PLATFORM_AXIS_PREFIX)?.segments[0];
  if (declaredPlatform === SYSTEM_PLATFORM_KEY) {
    return undefined;
  }
  const alert = triggerMenuAxis(preset.taxonomy, ALERT_AXIS_PREFIX)?.segments;
  if (!alert) {
    return undefined;
  }
  return [declaredPlatform ?? OTHER_PLATFORM_KEY, ...alert];
}

/** The id a node is addressed by in URLs and lookups. */
export function alertNodeId(path: readonly string[]): string {
  return path.join("/");
}

/**
 * Every trigger that declares an alert kind, as a menu tree: one root per platform,
 * ordered by label with Other last, and below each root the nested alert kinds,
 * ordered by label, with presets ordered by name.
 */
export function buildAlertTree(triggerPresets: TriggerPreset[]): AlertNode[] {
  const roots: AlertNode[] = [];
  for (const preset of triggerPresets) {
    const path = alertMenuPath(preset);
    if (!path) {
      continue;
    }
    let siblings = roots;
    let node: AlertNode | undefined;
    for (let depth = 0; depth < path.length; depth++) {
      node = siblings.find((candidate) => candidate.path[depth] === path[depth]);
      if (!node) {
        node = { path: path.slice(0, depth + 1), label: taxonomyLabel(path[depth]), presets: [], children: [] };
        siblings.push(node);
      }
      siblings = node.children;
    }
    if (!node) {
      throw new Error(`alert menu path for trigger "${preset.id}" is empty`);
    }
    node.presets.push(preset);
  }

  const sortNode = (node: AlertNode) => {
    node.presets.sort((a, b) => a.name.localeCompare(b.name));
    node.children.sort((a, b) => a.label.localeCompare(b.label));
    node.children.forEach(sortNode);
  };
  roots.forEach(sortNode);
  return roots.sort((a, b) => {
    const aOther = a.path[0] === OTHER_PLATFORM_KEY;
    const bOther = b.path[0] === OTHER_PLATFORM_KEY;
    if (aOther !== bOther) {
      return aOther ? 1 : -1;
    }
    return a.label.localeCompare(b.label);
  });
}

/** The node at `path`, or `undefined` when nothing registered sits there. */
export function findAlertNode(tree: readonly AlertNode[], path: readonly string[]): AlertNode | undefined {
  let siblings = tree;
  let node: AlertNode | undefined;
  for (const segment of path) {
    node = siblings.find((candidate) => candidate.path[candidate.path.length - 1] === segment);
    if (!node) {
      return undefined;
    }
    siblings = node.children;
  }
  return node;
}

/**
 * The element id of a trigger's section on its Alerts page, which the menu links to as
 * `#…`. Built from the event rather than the catalog row id, so a link survives the
 * module being reinstalled.
 */
export function alertSectionAnchor(preset: Pick<TriggerPreset, "id" | "event">): string {
  const slug = (preset.event || preset.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `event-${slug}`;
}

/**
 * The triggers a menu entry lists beneath itself as jumps to their sections: a leaf's
 * own, once there are two. A single trigger is the whole page, so a jump to it would
 * repeat the entry; a node with children is reached through them.
 */
export function anchoredPresets(node: AlertNode): TriggerPreset[] {
  return node.children.length === 0 && node.presets.length > 1 ? node.presets : [];
}

/** A node's own triggers, then its descendants' in menu order. */
export function subtreePresets(node: AlertNode): TriggerPreset[] {
  return [...node.presets, ...node.children.flatMap(subtreePresets)];
}

export interface AlertMenuSection {
  id: string;
  /** Every label from the platform down, e.g. "Twitch › Subscriptions › Gift". */
  label: string;
  presets: TriggerPreset[];
}

/** One section per node that holds triggers, in menu order, for a flat picker. */
export function flattenAlertTree(tree: readonly AlertNode[]): AlertMenuSection[] {
  const sections: AlertMenuSection[] = [];
  const walk = (node: AlertNode, labels: string[]) => {
    const trail = [...labels, node.label];
    if (node.presets.length > 0) {
      sections.push({ id: alertNodeId(node.path), label: trail.join(" › "), presets: node.presets });
    }
    for (const child of node.children) {
      walk(child, trail);
    }
  };
  for (const root of tree) {
    walk(root, []);
  }
  return sections;
}

/**
 * Configured-alert counts per node id, each node counting its whole subtree, so a
 * collapsed entry still says where the work is.
 */
export function countAlertsByNode(counts: readonly [path: readonly string[], count: number][]): Map<string, number> {
  const byNode = new Map<string, number>();
  for (const [path, count] of counts) {
    for (let depth = 1; depth <= path.length; depth++) {
      const id = alertNodeId(path.slice(0, depth));
      byNode.set(id, (byNode.get(id) ?? 0) + count);
    }
  }
  return byNode;
}

export interface PruneUnusedAlertsOptions {
  /** Configured-alert counts per node id, as `countAlertsByNode` builds them. */
  counts: ReadonlyMap<string, number>;
  /** Events with at least one configured alert, which decide the presets a kept node lists. */
  configuredEvents: ReadonlySet<string>;
  /** The selected node's id, kept with every node above it however unused they are. */
  selectedId: string | null;
}

/**
 * The tree pruned to the nodes with a configured alert somewhere in their subtree, each
 * listing only its configured presets, so the jumps under an entry match what it keeps.
 *
 * The selected node and the nodes above it always stay, so a deep link to an unused
 * event keeps its place in the menu. The selected node keeps all its presets too: its
 * page shows a section for each of them, and its jumps lead to those sections.
 */
export function pruneUnusedAlerts(tree: readonly AlertNode[], options: PruneUnusedAlertsOptions): AlertNode[] {
  const { counts, configuredEvents, selectedId } = options;
  const keep = (node: AlertNode): AlertNode | undefined => {
    const id = alertNodeId(node.path);
    const isSelected = selectedId === id;
    const holdsSelected = isSelected || (selectedId?.startsWith(`${id}/`) ?? false);
    if (!holdsSelected && (counts.get(id) ?? 0) === 0) {
      return undefined;
    }
    return {
      ...node,
      presets: isSelected
        ? node.presets
        : node.presets.filter((preset) => preset.event !== undefined && configuredEvents.has(preset.event)),
      children: node.children.flatMap((child) => keep(child) ?? []),
    };
  };
  return tree.flatMap((node) => keep(node) ?? []);
}
