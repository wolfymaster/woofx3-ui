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

/** The engine's Alert action (the bundled woofx3 module's `alert` action). */
export const ALERT_ACTION_ID = "alert";

/** The name an Alert step plays on: its `target`, or the default when blank, as alert widgets answer. */
export function alertStepTarget(parameters: Record<string, unknown> | undefined): string {
  const target = typeof parameters?.target === "string" ? parameters.target.trim() : "";
  return target || DEFAULT_ALERT_WIDGET_NAME;
}

/**
 * The names the Alert steps among `steps` target, in order. Takes a workflow's
 * tasks or a chat command's actions: both carry the action id in `action` and
 * its settings in `parameters`.
 */
export function alertStepTargets(steps: readonly unknown[]): string[] {
  const targets: string[] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) {
      continue;
    }
    const { action, parameters } = step as { action?: unknown; parameters?: unknown };
    if (action === ALERT_ACTION_ID) {
      targets.push(alertStepTarget(isRecord(parameters) ? parameters : undefined));
    }
  }
  return targets;
}

/** A widget placed on a scene, by the canonical id of what it places. */
export interface PlacedWidget {
  widgetId: string;
  settings?: Record<string, unknown>;
}

/**
 * The placements of a scene as the cache holds them, the engine's stored
 * entries as they are: an entry with no widget canonical id, or none of an
 * object's shape at all, is one the scene manager cannot read either, and is
 * left out.
 */
export function placedWidgetsOf(widgets: readonly unknown[]): PlacedWidget[] {
  return widgets.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const { widgetCanonicalId, settings } = entry as Record<string, unknown>;
    if (typeof widgetCanonicalId !== "string") {
      return [];
    }
    const isSettings = typeof settings === "object" && settings !== null && !Array.isArray(settings);
    return [{ widgetId: widgetCanonicalId, settings: isSettings ? (settings as Record<string, unknown>) : undefined }];
  });
}

/** The names a scene's alert widgets answer to. `alertWidgetIds` are the widgets that host alerts. */
export function alertWidgetNamesOf(
  placements: Iterable<PlacedWidget>,
  alertWidgetIds: ReadonlySet<string>
): Set<string> {
  const names = new Set<string>();
  for (const placement of placements) {
    if (alertWidgetIds.has(placement.widgetId)) {
      names.add(alertWidgetName(placement.settings));
    }
  }
  return names;
}

/** Something that plays alerts on a target name: a workflow's step or a chat command's action. */
export interface AlertTargetUse {
  target: string;
  kind: "workflow" | "command";
  /** The workflow's name, or the command as typed in chat ("!hype"). */
  name: string;
}

/** What runs Alert steps: a workflow's tasks, or a chat command's actions. */
export interface AlertStepSource {
  kind: AlertTargetUse["kind"];
  /** The workflow's name, or the command as typed in chat ("!hype"). */
  name: string;
  steps: readonly unknown[];
}

/** Every Alert step's target among `sources`, in order. */
export function alertTargetUses(sources: Iterable<AlertStepSource>): AlertTargetUse[] {
  const uses: AlertTargetUse[] = [];
  for (const source of sources) {
    for (const target of alertStepTargets(source.steps)) {
      uses.push({ target, kind: source.kind, name: source.name });
    }
  }
  return uses;
}

/**
 * The names the alert widgets of every scene answer to, for the Alert
 * action's target picker: the default first when some scene has it, then the
 * rest by name. Each scene is given by its stored placements.
 */
export function alertWidgetNamesAcross(
  scenes: Iterable<readonly unknown[]>,
  alertWidgetIds: ReadonlySet<string>
): string[] {
  const names = new Set<string>();
  for (const widgets of scenes) {
    for (const name of alertWidgetNamesOf(placedWidgetsOf(widgets), alertWidgetIds)) {
      names.add(name);
    }
  }
  const hasDefault = names.delete(DEFAULT_ALERT_WIDGET_NAME);
  const sorted = Array.from(names).sort((a, b) => a.localeCompare(b));
  return hasDefault ? [DEFAULT_ALERT_WIDGET_NAME, ...sorted] : sorted;
}

export interface OrphanedAlertTarget {
  target: string;
  uses: AlertTargetUse[];
}

/**
 * The targets an edit to one scene leaves with nowhere to play: names in use
 * that the scene answered to `before`, and that neither the scene `after` nor
 * any other scene (`elsewhere`) does. A target nothing answered to before the
 * edit is left out, since the edit did not cause it (the Alert action's
 * target picker flags those).
 */
export function orphanedAlertTargets(
  uses: readonly AlertTargetUse[],
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  elsewhere: ReadonlySet<string>
): OrphanedAlertTarget[] {
  const orphaned = new Map<string, AlertTargetUse[]>();
  for (const use of uses) {
    if (!before.has(use.target) || after.has(use.target) || elsewhere.has(use.target)) {
      continue;
    }
    const list = orphaned.get(use.target) ?? [];
    if (!list.some((seen) => seen.kind === use.kind && seen.name === use.name)) {
      list.push(use);
    }
    orphaned.set(use.target, list);
  }
  return Array.from(orphaned, ([target, list]) => ({ target, uses: list }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
