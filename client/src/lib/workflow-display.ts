import type { Doc } from "@convex/_generated/dataModel";
import type { WorkflowDefinition } from "@woofx3/api";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { triggerNodeLabel } from "@/lib/workflow-node-label";

type WorkflowRow = Doc<"workflows">;

/** Trigger label shown for workflows whose trigger is not an engine event. */
export const UNTRIGGERED_LABEL = "Other";

export function workflowName(row: WorkflowRow): string {
  const def = row.definition as { name?: string } | undefined;
  return def?.name ?? row.engineWorkflowId;
}

export function workflowDescription(row: WorkflowRow): string | undefined {
  return (row.definition as { description?: string } | undefined)?.description;
}

export function workflowStepCount(row: WorkflowRow): number {
  if (Array.isArray(row.nodes)) {
    return row.nodes.length;
  }
  const def = row.definition as { tasks?: unknown[] } | undefined;
  return (def?.tasks?.length ?? 0) + 1;
}

/** Friendly trigger name — same catalog resolution used for step-card labels. */
export function workflowTriggerLabel(row: WorkflowRow, catalogTriggers: CatalogTriggerRow[]): string {
  const trigger = (row.definition as WorkflowDefinition | undefined)?.trigger;
  if (!trigger || trigger.type !== "event") {
    return UNTRIGGERED_LABEL;
  }
  return triggerNodeLabel({ event: trigger.event, ref: (trigger as { $ref?: string }).$ref }, catalogTriggers);
}
