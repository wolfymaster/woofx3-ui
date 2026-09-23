import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import type { ResourceInstanceDoc } from "@/components/resources/resource-kind-page";
import { EventWorkflowEditor } from "@/components/triggers/event-workflow-editor";
import { useInstance } from "@/hooks/use-instance";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { resourceTriggers } from "@/lib/resource-triggers";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * What happens when something happens to this instance: one editor per trigger the
 * kind's events offer (a timer starting, pausing, ending), each showing only the
 * triggers pinned to this instance.
 *
 * These are the same workflows the Alerts screen edits — one per event, with a
 * condition per instance — so a resource page adds no second way to react to an
 * event, and an edit here shows up in the workflow builder like any other.
 */
export function ResourceTriggerEditors({
  kind,
  instance,
  triggerDetail,
}: {
  kind: string;
  instance: ResourceInstanceDoc;
  /** What a trigger's section shows about this instance above its triggers; see ResourceKindPage. */
  triggerDetail?: (preset: TriggerPreset) => ReactNode;
}) {
  const { instance: engineInstance } = useInstance();
  const { triggerPresets, actionPresets, loading } = useWorkflowCatalog();
  const workflows = useQuery(api.workflows.list, engineInstance ? { instanceId: engineInstance._id } : "skip");
  const triggers = useMemo(() => resourceTriggers(triggerPresets, kind), [triggerPresets, kind]);

  if (loading || workflows === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (triggers.length === 0) {
    return null;
  }

  const label = instance.displayName || instance.resourceInstanceId;
  return (
    <div className="flex flex-col gap-12 pt-4" data-testid={`resource-triggers-${kind}`}>
      {triggers.map(({ preset, fieldId }) => (
        <EventWorkflowEditor
          key={preset.id}
          triggerPreset={preset}
          actionPresets={actionPresets}
          workflows={workflows as Doc<"workflows">[]}
          breadcrumb={[]}
          headingLevel="h2"
          scope={{ fieldId, value: instance.canonicalId, label }}
        >
          {triggerDetail?.(preset)}
        </EventWorkflowEditor>
      ))}
    </div>
  );
}
