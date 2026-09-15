// Alert widgets are named areas on a scene where alert layouts play, and an
// Alert action targets them by name. These rules have to agree with the scene
// manager's matching (woofx3 sceneManager/src/scene/alert-layout.ts), which
// is why they live in one place.

/** What a scene's first alert widget is called, and what a step with no target plays on. */
export const DEFAULT_ALERT_WIDGET_NAME = "default";

/** The name an alert widget placement answers to: its `name` setting, or the default when blank. */
export function alertWidgetName(settings: Record<string, unknown> | undefined): string {
  const name = typeof settings?.name === "string" ? settings.name.trim() : "";
  return name || DEFAULT_ALERT_WIDGET_NAME;
}

/**
 * A name for a new alert widget on a scene whose alert widgets already answer
 * to `existing`: the default for the first, then the first free `alert-N`, so
 * two alert widgets on one scene never share a name by accident.
 */
export function nextAlertWidgetName(existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(DEFAULT_ALERT_WIDGET_NAME)) {
    return DEFAULT_ALERT_WIDGET_NAME;
  }
  for (let n = 2; ; n++) {
    const candidate = `alert-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
