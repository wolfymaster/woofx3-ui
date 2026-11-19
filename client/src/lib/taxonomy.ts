/**
 * Taxonomy is a set of named axes (`platform.twitch`, `alert.subscription.gift`), not an
 * encoded event name. This module owns the validated shape of an axis and the two policies that
 * read it: the Alerts menu looks up axes by prefix, while action placement takes the first
 * well-formed entry whatever family it names. Both share one segment validator; keeping the
 * choice of entry as two named functions makes their different acceptance explicit.
 */

/** A well-formed entry: its axis prefix (empty for an unqualified entry) and trimmed segments. */
export interface TaxonomyAxis {
  prefix: string;
  segments: readonly string[];
}

function parseAxis(entry: string, prefix: string): TaxonomyAxis | undefined {
  const segments = entry
    .slice(prefix.length)
    .split(".")
    .map((segment) => segment.trim());
  return segments.every((segment) => segment.length > 0) ? { prefix, segments } : undefined;
}

/**
 * Trigger menu policy: the first entry naming `prefix`. Taxonomy is multi-valued to carry
 * independent axes, so a malformed `platform.*` does not hide a valid `alert.*` axis.
 */
export function triggerMenuAxis(taxonomy: readonly string[] | undefined, prefix: string): TaxonomyAxis | undefined {
  const entry = taxonomy?.find((candidate) => candidate.startsWith(prefix));
  return entry === undefined ? undefined : parseAxis(entry, prefix);
}

/**
 * Action placement policy: the first non-blank entry, whatever its family. An action's first
 * entry is its object; a later, unrelated axis cannot move it.
 */
export function actionPlacementEntry(taxonomy: readonly string[] | undefined): TaxonomyAxis | undefined {
  const entry = taxonomy?.find((candidate) => candidate.trim() !== "");
  return entry === undefined ? undefined : parseAxis(entry, "");
}

/**
 * Labels where humanising a segment gives the wrong words. Only the cases a reader
 * would notice; everything else title-cases correctly on its own, and an entry here
 * is a phrase the UI owns rather than one the module author does.
 */
const LABEL_OVERRIDES: Record<string, string> = {
  ai: "AI",
  channelpoints: "Channel Points",
  counter: "Counters",
  lifx: "LIFX",
  obs: "OBS",
  queue: "Queues",
  schedule: "Schedules",
  subscription: "Subscriptions",
  timer: "Timers",
  watchstreak: "Watch Streak",
  hypetrain: "Hype Train",
};

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
