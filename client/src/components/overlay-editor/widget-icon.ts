import { Bell, Film, Image, Sparkles, Square, Type, Volume2 } from "lucide-react";

export type WidgetIcon = typeof Square;

/**
 * The icon a widget's taxonomy family earns, most specific axis first.
 *
 * Keyed on the declared taxonomy rather than the widget id, so a module's own
 * video widget gets the film icon without this list learning its name. A widget
 * that declares nothing falls back to the generic box.
 */
const FAMILY_ICON: Record<string, WidgetIcon> = {
  alert: Bell,
  text: Type,
  "media.image": Image,
  "media.video": Film,
  "media.audio": Volume2,
  "media.animation": Sparkles,
};

export function widgetIconFor(taxonomy: readonly string[] | undefined): WidgetIcon {
  for (const entry of taxonomy ?? []) {
    const icon = FAMILY_ICON[entry] ?? FAMILY_ICON[entry.split(".")[0]];
    if (icon) {
      return icon;
    }
  }
  return Square;
}
