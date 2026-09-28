import { THEME_FIELD_TYPE, type WidgetThemeOption } from "@convex/lib/widgetThemes";

/** Takes a plain string so the check typechecks while the SDK's field type union lacks `theme`. */
export function isThemeField(field: { type: string }): boolean {
  return field.type === THEME_FIELD_TYPE;
}

/**
 * What the picker shows for a stored value.
 *
 * `missing` and `incompatible` are the two cases where the overlay renders the
 * widget's defaults instead of the chosen theme, so the picker must say so
 * rather than show a selection that is not what is on screen.
 */
export type ThemeSelection =
  | { kind: "default" }
  | { kind: "selected"; theme: WidgetThemeOption }
  | { kind: "missing"; themeId: string }
  | { kind: "incompatible"; theme: WidgetThemeOption };

export function themeSelection(stored: unknown, themes: readonly WidgetThemeOption[]): ThemeSelection {
  if (typeof stored !== "string" || stored.length === 0) {
    return { kind: "default" };
  }
  const theme = themes.find((candidate) => candidate.id === stored);
  if (!theme) {
    return { kind: "missing", themeId: stored };
  }
  if (!theme.compatible) {
    return { kind: "incompatible", theme };
  }
  return { kind: "selected", theme };
}

/**
 * Radix Select reserves the empty string for "no selection", so "Default"
 * needs a value of its own. A theme id always contains `:theme:`, so this
 * cannot collide with one.
 */
export const DEFAULT_THEME_VALUE = "__default__";

export interface ThemePickerOption {
  value: string;
  label: string;
}

/** "Default" first, then the themes that fit the widget's contract; an incompatible one would render the defaults. */
export function themePickerOptions(themes: readonly WidgetThemeOption[]): ThemePickerOption[] {
  const options: ThemePickerOption[] = [{ value: DEFAULT_THEME_VALUE, label: "Default" }];
  for (const theme of themes) {
    if (theme.compatible) {
      options.push({ value: theme.id, label: theme.name });
    }
  }
  return options;
}

/** The Select's value; empty for a stored theme that is not offered, so the trigger shows the placeholder. */
export function themePickerValue(selection: ThemeSelection): string {
  switch (selection.kind) {
    case "default": {
      return DEFAULT_THEME_VALUE;
    }
    case "selected": {
      return selection.theme.id;
    }
    case "missing":
    case "incompatible": {
      return "";
    }
  }
}

/** The stored setting for a picked value: unset means the widget's own look. */
export function themeSettingValue(pickerValue: string): string | undefined {
  return pickerValue === DEFAULT_THEME_VALUE ? undefined : pickerValue;
}

/** Why the overlay is not showing the stored theme, or null when it is. */
export function themeMismatchNotice(selection: ThemeSelection): string | null {
  switch (selection.kind) {
    case "default":
    case "selected": {
      return null;
    }
    case "missing": {
      return `The selected theme (${selection.themeId}) is no longer installed, so the overlay shows this widget's default look. Pick another theme or Default.`;
    }
    case "incompatible": {
      return `"${selection.theme.name}" does not fit this version of the widget, so the overlay shows its default look. Pick another theme or Default.`;
    }
  }
}
