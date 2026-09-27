/**
 * The theme picker behind a widget's `theme` settings field.
 *
 * The engine adds that field to the `settingsSchema` of a widget that declares
 * a theme contract; manifests cannot declare it. Its value is a theme's
 * canonical id (`{moduleId}:theme:{id}`), or absent for the widget's own look.
 *
 * The field type, the setting id and the RPC shapes below are declared here
 * rather than imported because `@woofx3/api` does not export them until the
 * engine ships widget themes. They must match `CONFIG_FIELD_TYPES` /
 * `THEME_SETTING_ID` in the engine's `shared/clients/typescript/api/ui-schema.ts`
 * and `WidgetThemeOption` / `WidgetThemes` / `listWidgetThemes` in its `api.ts`.
 * Once `@woofx3/api` exports them, import them from there and delete these.
 */

export const THEME_FIELD_TYPE = "theme";

export const THEME_SETTING_ID = "theme";

export interface WidgetThemeOption {
  /** Theme canonical id `{moduleId}:theme:{id}`: the value the field stores. */
  id: string;
  name: string;
  description: string;
  moduleId: string;
  moduleVersion: string;
  contractVersion: number;
  /** False when the theme no longer fits the widget's current contract; the overlay renders defaults for it. */
  compatible: boolean;
  previewUrl: string | null;
}

export interface WidgetThemes {
  widget: string;
  /** Null when the widget cannot be themed. */
  contractVersion: number | null;
  /** Ordered by name. */
  themes: WidgetThemeOption[];
}

export interface WidgetThemesApi {
  listWidgetThemes(widgetCanonicalId: string): Promise<WidgetThemes>;
}

/**
 * A value that changes whenever a module is installed, upgraded or removed.
 *
 * Themes only come and go with module installs, and the `module.installed` and
 * `module.deleted` webhooks are what move `moduleRepository` rows in and out of
 * `installed`. The picker refetches its list when this changes.
 */
export function installedModulesRevision(rows: ReadonlyArray<{ status?: string; moduleKey?: string }>): string {
  return rows
    .filter((row) => row.status === "installed")
    .map((row) => row.moduleKey ?? "")
    .sort()
    .join("\n");
}
