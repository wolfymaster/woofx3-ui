export interface AlertTargetChoices {
  /** The option to show as selected, or "" when nothing is chosen yet. */
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
 * A blank stored value selects nothing: the user always picks a target, rather than
 * inheriting one they never saw. A stored name matches a widget name after trimming,
 * as `alertWidgetName` trims the name setting, so `"sidebar "` is not flagged stale.
 * While the names load, the stored value is the only option, so the field shows it
 * without judging it.
 */
export function alertTargetChoices(names: readonly string[] | undefined, value: unknown): AlertTargetChoices {
  const stored = typeof value === "string" ? value : "";
  const trimmed = stored.trim();
  if (names === undefined) {
    return { selected: trimmed, options: trimmed ? [trimmed] : [], stale: null };
  }
  if (trimmed === "" || names.includes(trimmed)) {
    return { selected: trimmed, options: [...names], stale: null };
  }
  return { selected: stored, options: [stored, ...names], stale: stored };
}
