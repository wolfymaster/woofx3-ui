import { v } from "convex/values";

/** How the widget catalog stores `WidgetBehaviorKinds` (shared/widget-behavior-kinds.ts). */
const behaviorKindValidator = v.object({ id: v.string(), label: v.string() });

export const widgetBehaviorKindsValidator = v.object({
  transitions: v.array(behaviorKindValidator),
  effects: v.array(behaviorKindValidator),
});
