import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * Alert groups — "what happened", never "which platform".
 *
 * Grouping reads the trigger's declared `alert.*` taxonomy axis rather than
 * parsing its event name. A module author says what kind of thing their trigger
 * reports; the UI does not infer it, and a trigger named `alert.donation` from
 * any platform joins the Donation group the moment the module is installed.
 *
 * That distinction is not academic. This screen previously derived the group
 * from the leading segment of the event name, which held only while events read
 * `{what}.{scope}.{platform}`. Once they became `{scope}.{what}`
 * (`channel.follow`, `channel.cheer`), every channel event collapsed into one
 * "Channel" group. A declared axis cannot be reshaped by a rename.
 *
 * A trigger with no `alert.*` axis is not an alert type, so workflow and module
 * lifecycle triggers stop being offered as things to alert on — which they
 * never should have been.
 */
export interface AlertGroup {
  /** URL-safe segment, e.g. `cheer` — the axis leaf, not the event name. */
  key: string;
  label: string;
  presets: TriggerPreset[];
}

const ALERT_AXIS_PREFIX = "alert.";

/**
 * Labels where humanising the axis leaf gives the wrong words. Only the cases a
 * reader would notice — everything else title-cases correctly on its own, and an
 * entry here is a phrase the UI owns rather than one the module author does.
 */
const GROUP_LABEL_OVERRIDES: Record<string, string> = {
  channelpoints: "Channel Points",
  subscription: "Subscriptions",
  watchstreak: "Watch Streak",
  hypetrain: "Hype Train",
};

/**
 * The alert kind a trigger reports, or `undefined` when it is not an alert.
 *
 * Only the first `alert.*` axis counts. Taxonomy is multi-valued to carry
 * independent axes (`platform.twitch` alongside `alert.follow`), not to put one
 * trigger in two alert groups.
 */
export function alertGroupKey(preset: Pick<TriggerPreset, "taxonomy">): string | undefined {
  const axis = preset.taxonomy?.find((entry) => entry.startsWith(ALERT_AXIS_PREFIX));
  if (!axis) {
    return undefined;
  }
  const leaf = axis.slice(ALERT_AXIS_PREFIX.length).trim();
  return leaf.length > 0 ? leaf : undefined;
}

/** `subscriptionGift` → "Subscription Gift"; known leaves get their real name. */
export function alertGroupLabel(key: string): string {
  const override = GROUP_LABEL_OVERRIDES[key];
  if (override) {
    return override;
  }
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Every trigger that declares an alert kind, grouped by it, ordered by label. */
export function buildAlertGroups(triggerPresets: TriggerPreset[]): AlertGroup[] {
  const byKey = new Map<string, TriggerPreset[]>();
  for (const preset of triggerPresets) {
    const key = alertGroupKey(preset);
    if (!key) {
      continue;
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.push(preset);
    } else {
      byKey.set(key, [preset]);
    }
  }
  return Array.from(byKey.entries())
    .map(([key, presets]) => ({
      key,
      label: alertGroupLabel(key),
      presets: [...presets].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function findAlertGroup(groups: AlertGroup[], key: string | undefined): AlertGroup | undefined {
  if (!key) {
    return undefined;
  }
  return groups.find((group) => group.key === key);
}
