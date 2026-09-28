import { DEFAULT_ALERT_WIDGET_NAME } from "@convex/lib/alertWidgets";

export interface AlertTargetChoices {
  /** The option to show as selected; always one of `options`. */
  selected: string;
  /** Names to offer, a stale stored name first. */
  options: string[];
  /**
   * The stored name when no scene has an alert widget answering to it, else null.
   * Kept as an option rather than replaced, so a step never loses its saved target
   * just by being opened.
   */
  stale: string | null;
}

/**
 * The options for an Alert action's target picker, from the names the instance's
 * scenes' alert widgets answer to (`undefined` while they load) and the stored value.
 *
 * A blank stored value selects the default, which is what the engine plays an
 * untargeted alert on. A stored name matches a widget name after trimming, as
 * `alertWidgetName` trims the name setting, so `"sidebar "` is not flagged stale.
 * While the names load, the stored value is the only option, so the field shows it
 * without judging it.
 */
export function alertTargetChoices(names: readonly string[] | undefined, value: unknown): AlertTargetChoices {
  const stored = typeof value === "string" ? value : "";
  const trimmed = stored.trim();
  const wanted = trimmed || DEFAULT_ALERT_WIDGET_NAME;
  if (names === undefined) {
    return { selected: wanted, options: [wanted], stale: null };
  }
  const offered = names.includes(DEFAULT_ALERT_WIDGET_NAME) ? [...names] : [DEFAULT_ALERT_WIDGET_NAME, ...names];
  if (offered.includes(wanted)) {
    return { selected: wanted, options: offered, stale: null };
  }
  return { selected: stored, options: [stored, ...offered], stale: stored };
}
