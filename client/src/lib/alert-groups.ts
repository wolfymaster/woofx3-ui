import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * Alert groups — "what happened", never "which platform".
 *
 * Engine event names read `{what}.{scope}.{platform}` (`cheer.channel.twitch`,
 * `redeem.channelpoints.twitch`, `subscriptionGift.channel.twitch`), so the leading
 * segment is the platform-neutral kind of thing that happened. Grouping on it keeps
 * the UI neutral — a viewer subscribing is a subscription whether it came from Twitch
 * or anywhere else — and picks up a module's events with no vocabulary of ours to
 * update: a trigger named `donation.channel.throne` becomes a Donation group the
 * moment the module is installed.
 */
export interface AlertGroup {
  /** URL-safe segment, e.g. `cheer`. */
  key: string;
  label: string;
  presets: TriggerPreset[];
}

export function alertGroupKey(event: string): string {
  return event.split(".")[0] ?? event;
}

/** `subscriptionGift` → "Subscription Gift". */
export function alertGroupLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Every registered trigger, grouped by what it reports, ordered by label. */
export function buildAlertGroups(triggerPresets: TriggerPreset[]): AlertGroup[] {
  const byKey = new Map<string, TriggerPreset[]>();
  for (const preset of triggerPresets) {
    if (!preset.event) {
      continue;
    }
    const key = alertGroupKey(preset.event);
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
