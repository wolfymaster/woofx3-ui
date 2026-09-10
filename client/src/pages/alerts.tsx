import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Bell, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { AlertGroupRail } from "@/components/alerts/alert-group-rail";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { EventWorkflowEditor } from "@/components/triggers/event-workflow-editor";
import { useInstance } from "@/hooks/use-instance";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import { alertGroupKey, buildAlertGroups, findAlertGroup } from "@/lib/alert-groups";
import { projectWorkflow } from "@/lib/trigger-projection";

const BASE_PATH = "/stream/alerts";

/**
 * Triggers, grouped by what happened.
 *
 * Each event's configured triggers live in one workflow, so this screen is a projection
 * of the engine's own records — see lib/trigger-projection.ts. Nothing is stored here.
 */
export default function Alerts() {
  const params = useParams<{ group?: string }>();
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const { triggerPresets, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const workflows = useQuery(api.workflows.list, instance ? { instanceId: instance._id as Id<"instances"> } : "skip");

  const groups = useMemo(() => buildAlertGroups(triggerPresets), [triggerPresets]);
  const rows = useMemo(() => (workflows ?? []) as Doc<"workflows">[], [workflows]);
  const loading = catalogLoading || workflows === undefined;

  // Configured-trigger count per group, so the rail says where the work already
  // is. A workflow's group comes from the trigger it binds to, since the alert
  // kind is declared on the trigger rather than derivable from the event.
  const groupKeyByEvent = useMemo(() => {
    const byEvent = new Map<string, string>();
    for (const preset of triggerPresets) {
      const key = alertGroupKey(preset);
      if (key && preset.event) {
        byEvent.set(preset.event, key);
      }
    }
    return byEvent;
  }, [triggerPresets]);

  const counts = useMemo(() => {
    const byGroup = new Map<string, number>();
    for (const row of rows) {
      const projected = projectWorkflow(row);
      if (!projected.ok) {
        continue;
      }
      const key = groupKeyByEvent.get(projected.projection.event);
      if (!key) {
        continue;
      }
      byGroup.set(key, (byGroup.get(key) ?? 0) + projected.projection.triggers.length);
    }
    return byGroup;
  }, [rows, groupKeyByEvent]);

  const groupKey = params?.group ?? null;
  const group = findAlertGroup(groups, groupKey ?? undefined);

  return (
    <div className="flex h-full overflow-hidden">
      <AlertGroupRail groups={groups} counts={counts} selectedKey={groupKey} basePath={BASE_PATH} />

      <div className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8 max-w-[900px]">
          <PageHeader
            title={group ? group.label : "Alerts"}
            description={
              group
                ? "Every trigger configured for this kind of event, and what each one does."
                : "Pick a kind of event on the left. Each one is backed by a workflow you can also open in the builder."
            }
          />

          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : groupKey === null ? (
            <EmptyState
              icon={Bell}
              title="Choose an event type"
              description="Cheers, subscriptions, raids — whatever a module registers shows up in the list on the left."
            />
          ) : !group ? (
            <EmptyState
              icon={Bell}
              title="No such event type"
              description="Nothing registered reports this kind of event. It may have come from a module that is no longer installed."
              action={{ label: "Back to alerts", onClick: () => navigate(BASE_PATH) }}
            />
          ) : (
            <div className="space-y-10">
              {group.presets.map((preset) => (
                <EventWorkflowEditor
                  key={preset.id}
                  triggerPreset={preset}
                  actionPresets={actionPresets}
                  workflows={rows}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
