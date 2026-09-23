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
 * lifecycle triggers are never offered as things to alert on.
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

/**
 * Labels where humanising a segment gives the wrong words. Only the cases a reader
 * would notice; everything else title-cases correctly on its own, and an entry here
 * is a phrase the UI owns rather than one the module author does.
 */
const LABEL_OVERRIDES: Record<string, string> = {
  channelpoints: "Channel Points",
  counter: "Counters",
  subscription: "Subscriptions",
  watchstreak: "Watch Streak",
  hypetrain: "Hype Train",
};

/**
 * The segments of a trigger's first axis with this prefix, or `undefined` when it has
 * none or the axis is malformed (`alert.`, `alert.a..b`).
 *
 * Only the first matching axis counts. Taxonomy is multi-valued to carry independent
 * axes (`platform.twitch` alongside `alert.follow`), not to put one trigger in two places.
 */
function axisSegments(preset: Pick<TriggerPreset, "taxonomy">, prefix: string): string[] | undefined {
  const axis = preset.taxonomy?.find((entry) => entry.startsWith(prefix));
  if (!axis) {
    return undefined;
  }
  const segments = axis
    .slice(prefix.length)
    .split(".")
    .map((segment) => segment.trim());
  return segments.every((segment) => segment.length > 0) ? segments : undefined;
}

/**
 * Where a trigger sits in the Alerts menu: its platform, then each `alert.*` segment.
 * `undefined` when the trigger declares no alert kind.
 */
export function alertMenuPath(preset: Pick<TriggerPreset, "taxonomy">): string[] | undefined {
  const alert = axisSegments(preset, ALERT_AXIS_PREFIX);
  if (!alert) {
    return undefined;
  }
  const platform = axisSegments(preset, PLATFORM_AXIS_PREFIX)?.[0] ?? OTHER_PLATFORM_KEY;
  return [platform, ...alert];
}

/** `subscriptionGift` → "Subscription Gift"; known segments get their real name. */
export function taxonomyLabel(segment: string): string {
  const override = LABEL_OVERRIDES[segment];
  if (override) {
    return override;
  }
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
