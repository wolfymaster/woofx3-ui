import { type Infer, v } from "convex/values";
import { COUNTER_KIND } from "@convex/lib/resourceKinds";
import { formatDuration } from "@/lib/format";

export const sectionValidator = v.object({ id: v.string(), kind: v.string(), widgets: v.array(v.string()) });
export type Section = Infer<typeof sectionValidator>;

export function isCounterSection(section: Section): boolean {
  return section.kind === COUNTER_KIND;
}

export function sectionAge(ms: number): string {
  return formatDuration(ms);
}
