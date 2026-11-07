import { Bell, Film, Image, Sparkles, Square, Type, Volume2 } from "lucide-react";
import { STREAM_OBJECT_ICONS } from "@/lib/stream-object-icons";

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
  // A data widget shows one of the streamer's own things, so it wears that thing's icon.
  "data.counter": STREAM_OBJECT_ICONS.counters,
  "data.timer": STREAM_OBJECT_ICONS.timers,
  "data.queue": STREAM_OBJECT_ICONS.queues,
  "data.database": STREAM_OBJECT_ICONS.databases,
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
