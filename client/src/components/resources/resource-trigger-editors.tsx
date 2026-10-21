import { bareKind } from "@convex/lib/resourceKinds";
import { Loader2 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { EventTriggerList } from "@/components/alerts/event-trigger-list";
import { useEngineScope } from "@/engine/context";
import { useWorkflows } from "@/engine/hooks/use-workflows";
import type { ModuleResourceInstance } from "@/engine/types";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { resourceTriggers } from "@/lib/resource-triggers";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * What happens when something happens to this instance: one editor per trigger the
 * kind's events offer (a timer starting, pausing, ending), each showing only the
 * triggers pinned to this instance.
 *
 * These are the same workflows the Alerts screen edits — one per trigger, pinned to
 * this instance by a condition — so a resource page adds no second way to react to an
 * event, and an edit here shows up in the workflow builder like any other.
 */
export function ResourceTriggerEditors({
  kind,
  instance,
  triggerDetail,
}: {
  kind: string;
  instance: ModuleResourceInstance;
  /** What a trigger's section shows about this instance above its triggers; see ResourceKindPage. */
  triggerDetail?: (preset: TriggerPreset) => ReactNode;
}) {
  const { instanceId } = useEngineScope();
  const { triggerPresets, loading } = useWorkflowCatalog();
  const workflows = useWorkflows(instanceId);
  const triggers = useMemo(() => resourceTriggers(triggerPresets, kind), [triggerPresets, kind]);

  if (loading || workflows === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (triggers.length === 0) {
    return null;
  }

  const label = instance.displayName || instance.resourceInstanceId;
  return (
    <div className="flex flex-col gap-12 pt-4" data-testid={`resource-triggers-${bareKind(kind)}`}>
      {triggers.map(({ preset, fieldId }) => (
        <EventTriggerList
          key={preset.id}
          triggerPreset={preset}
          workflows={workflows}
          breadcrumb={[]}
          headingLevel="h2"
          pin={{ fieldId, value: instance.canonicalId, label }}
        >
          {triggerDetail?.(preset)}
        </EventTriggerList>
      ))}
    </div>
  );
}
