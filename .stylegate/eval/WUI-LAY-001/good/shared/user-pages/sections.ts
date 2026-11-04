import { parseWidgetKey } from "@shared/widget-key";
import { COUNTER_KIND } from "./kinds";

export interface Section {
  id: string;
  kind: string;
  widgets: string[];
}

export function isCounterSection(section: Section): boolean {
  return section.kind === COUNTER_KIND;
}

export function widgetModules(section: Section): string[] {
  return section.widgets.map((key) => parseWidgetKey(key).moduleId);
}

export function describeConvexOutage(): string {
  return "convex/values could not be reached";
}
