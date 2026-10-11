import { COUNTER_KIND, QUEUE_KIND, TIMER_KIND } from "@convex/lib/resourceKinds";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ResourceDetailProps } from "@/components/resources/resource-kind-page";
import { counterView } from "@/components/resources/views/counter-view";
import { queueView } from "@/components/resources/views/queue-view";
import { timerView } from "@/components/resources/views/timer-view";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * How a kind's page shows its instances. Every kind gets the same page; a view
 * changes only what the page cannot work out from the declarations alone.
 */
export interface KindView {
  /** Said under the title in place of the kind's own description. */
  description?: string;
  /** Shown until the kind's declaration has loaded, so the header doesn't change under the reader. */
  icon?: LucideIcon;
  /** The value beside an instance's name in the rail. */
  railValue: (props: ResourceDetailProps) => ReactNode;
  /** What the kind shows and lets you do, above its settings. */
  detail: (props: ResourceDetailProps) => ReactNode;
  /**
   * What a trigger's section shows about the instance above its triggers, such
   * as the goals a goal trigger fires on. Null for a trigger with nothing to add.
   */
  triggerDetail?: (preset: TriggerPreset, props: ResourceDetailProps) => ReactNode;
}

/** The kinds the dashboard knows well enough to show better than their declarations alone do. */
const KIND_VIEWS: Readonly<Record<string, KindView>> = {
  [COUNTER_KIND]: counterView,
  [TIMER_KIND]: timerView,
  [QUEUE_KIND]: queueView,
};

/** The view made for a kind, as `module:kind`; null for a kind shown from its declarations. */
export function kindViewFor(qualifiedKind: string): KindView | null {
  return KIND_VIEWS[qualifiedKind] ?? null;
}
