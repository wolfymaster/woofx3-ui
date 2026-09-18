import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Bell, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertGroupRail } from "@/components/alerts/alert-group-rail";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { TestEventSheet } from "@/components/test-events/test-event-sheet";
import { EventWorkflowEditor } from "@/components/triggers/event-workflow-editor";
import { useInstance } from "@/hooks/use-instance";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import {
  alertMenuPath,
  alertNodeId,
  buildAlertTree,
  countAlertsByNode,
  findAlertNode,
  flattenAlertTree,
  subtreePresets,
  taxonomyLabel,
} from "@/lib/alert-groups";
import { projectWorkflow } from "@/lib/trigger-projection";

const BASE_PATH = "/stream/alerts";

/**
 * Triggers, grouped by platform and then by what happened.
 *
 * Each event's configured triggers live in one workflow, so this screen is a projection
 * of the engine's own records — see lib/trigger-projection.ts. Nothing is stored here.
 */
export default function Alerts() {
  // Everything below the Alerts route is the selected menu path, as deep as the taxonomy nests.
  const params = useParams<{ "*"?: string }>();
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const { triggerPresets, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const workflows = useQuery(api.workflows.list, instance ? { instanceId: instance._id as Id<"instances"> } : "skip");

  // The trigger stays selected while the sheet closes, so its contents don't blank
  // out mid-animation.
  const [testPresetId, setTestPresetId] = useState<string | null>(null);
  const [isTestOpen, setIsTestOpen] = useState(false);

  const tree = useMemo(() => buildAlertTree(triggerPresets), [triggerPresets]);
  const sections = useMemo(() => flattenAlertTree(tree), [tree]);
  const rows = useMemo(() => (workflows ?? []) as Doc<"workflows">[], [workflows]);
  const loading = catalogLoading || workflows === undefined;

  // Configured-trigger count per menu entry, so the rail says where the work already
  // is. A workflow's place comes from the trigger it binds to, since platform and
  // alert kind are declared on the trigger rather than derivable from the event.
  const menuPathByEvent = useMemo(() => {
    const byEvent = new Map<string, string[]>();
    for (const preset of triggerPresets) {
      const path = alertMenuPath(preset);
      if (path && preset.event) {
        byEvent.set(preset.event, path);
      }
    }
    return byEvent;
  }, [triggerPresets]);

  const counts = useMemo(() => {
    const perWorkflow: [string[], number][] = [];
    for (const row of rows) {
      const projected = projectWorkflow(row);
      if (!projected.ok) {
        continue;
      }
      const path = menuPathByEvent.get(projected.projection.event);
      if (path) {
        perWorkflow.push([path, projected.projection.triggers.length]);
      }
    }
    return countAlertsByNode(perWorkflow);
  }, [rows, menuPathByEvent]);

  const selectedPath = (params?.["*"] ?? "").split("/").filter(Boolean).map(decodeSegment);
  const selectedId = selectedPath.length > 0 ? alertNodeId(selectedPath) : null;
  const node = selectedId === null ? undefined : findAlertNode(tree, selectedPath);
  const nodePresets = node ? subtreePresets(node) : [];
  // A leaf label alone does not say which entry this is once a segment repeats at
  // two depths — `alert.subscription.gift` and `alert.shared.subscription.gift`
  // both end in "Gift" — so the title names the whole trail, as the rail shows it.
  const nodeTrail = node ? selectedPath.map(taxonomyLabel).join(" › ") : null;

  function openTest(presetId: string) {
    setTestPresetId(presetId);
    setIsTestOpen(true);
  }

  return (
    <div className="flex h-full overflow-hidden">
      <AlertGroupRail tree={tree} counts={counts} selectedId={selectedId} basePath={BASE_PATH} />

      <div className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8 max-w-[900px]">
          <PageHeader
            title={nodeTrail ?? "Alerts"}
            description={
              node
                ? "Every trigger configured for this kind of event, and what each one does."
                : "Pick a kind of event on the left. Each one is backed by a workflow you can also open in the builder."
            }
          />

          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : selectedId === null ? (
            <EmptyState
              icon={Bell}
              title="Choose an event type"
              description="Cheers, subscriptions, raids — whatever a module registers shows up in the list on the left."
            />
          ) : !node ? (
            <EmptyState
              icon={Bell}
              title="No such event type"
              description="Nothing registered reports this kind of event. It may have come from a module that is no longer installed."
              action={{ label: "Back to alerts", onClick: () => navigate(BASE_PATH) }}
            />
          ) : (
            <div className="space-y-10">
              {nodePresets.map((preset) => (
                <EventWorkflowEditor
                  key={preset.id}
                  triggerPreset={preset}
                  actionPresets={actionPresets}
                  workflows={rows}
                  onTest={() => openTest(preset.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <TestEventSheet
        open={isTestOpen}
        onOpenChange={setIsTestOpen}
        sections={sections}
        selectedId={testPresetId}
        onSelect={setTestPresetId}
      />
    </div>
  );
}

/** A URL path segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
