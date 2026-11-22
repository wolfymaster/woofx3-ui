import { THEME_FIELD_TYPE } from "@convex/lib/widgetThemes";
import { ConfigButtonFieldRenderer } from "@/components/common/config-button-field";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { ThemeFieldRenderer } from "@/components/scenes/theme-field";
import {
  AlertWidgetNameRenderer,
  LayoutFieldRenderer,
  MediaFieldRenderer,
  ResourceRefFieldRenderer,
} from "@/components/workflows/custom-field-renderers";
import { DatabaseColumnsFieldRenderer } from "@/components/workflows/database-field-renderers";
import { ScenePlacementsFieldRenderer, ScenesFieldRenderer } from "@/components/workflows/scene-field-renderers";

/**
 * The renderers ConfigurationForm cannot supply generically, because they need
 * pickers wired to app state — the asset library, the resource instance list,
 * the alert widget names and the layout canvas. Exported so every surface that
 * renders a ConfigField gets the same controls: a `resource_ref` in a widget's
 * settings must pick a resource the same way one in a trigger's config does.
 */
export const configFieldRenderers: Record<string, CustomFieldRenderer> = {
  media: MediaFieldRenderer,
  asset: MediaFieldRenderer,
  resource_ref: ResourceRefFieldRenderer,
  "field:layout": LayoutFieldRenderer,
  // A button stores nothing, so there is no value for a variable to stand in for.
  "field:button": ConfigButtonFieldRenderer,
  "source:alertWidgets": AlertWidgetNameRenderer,
  "source:scenes": ScenesFieldRenderer,
  "source:scenePlacements": ScenePlacementsFieldRenderer,
  "source:databaseColumns": DatabaseColumnsFieldRenderer,
  // A theme is chosen per widget placement, never by a workflow, so it takes no variable toggle.
  [`field:${THEME_FIELD_TYPE}`]: ThemeFieldRenderer,
};
