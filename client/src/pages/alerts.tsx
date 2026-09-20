import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Bell, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertGroupRail } from "@/components/alerts/alert-group-rail";
import { AlertsDashboard } from "@/components/alerts/dashboard/alerts-dashboard";
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
import { cn } from "@/lib/utils";

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

  // A jump from the menu to one trigger's section. The request carries a nonce so
  // following the same jump twice scrolls twice; a link opened with a #hash starts
  // with one.
  const [activeAnchor, setActiveAnchor] = useState<string | null>(() => currentHash());
  const [scrollRequest, setScrollRequest] = useState<{ anchor: string; nonce: number } | null>(() => {
    const anchor = currentHash();
    return anchor ? { anchor, nonce: 0 } : null;
  });
  const requestScroll = (anchor: string) => {
    setActiveAnchor(anchor);
    setScrollRequest({ anchor, nonce: Date.now() });
  };

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
  // A lone event's title is its own name, so the trail above it stops at its parent.
  const breadcrumb = selectedPath.slice(0, -1).map(taxonomyLabel);

  // Leaving for an entry of the menu drops the jump marker, since that link has no #hash.
  useEffect(() => {
    if (selectedId !== null && currentHash() === null) {
      setActiveAnchor(null);
    }
  }, [selectedId]);

  // Waits two frames before scrolling: each section opens its draft in an effect, and
  // the sections above the target must reach their full height first or it lands short.
  useEffect(() => {
    if (!scrollRequest || loading) {
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        document.getElementById(scrollRequest.anchor)?.scrollIntoView({ block: "start", behavior: "smooth" });
        setScrollRequest(null);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [scrollRequest, loading]);

  function openTest(presetId: string) {
    setTestPresetId(presetId);
    setIsTestOpen(true);
  }

  return (
    <div className="flex h-full overflow-hidden">
      <AlertGroupRail
        tree={tree}
        counts={counts}
        selectedId={selectedId}
        basePath={BASE_PATH}
        activeAnchor={activeAnchor}
        onAnchorSelect={requestScroll}
      />

      <div className="flex-1 overflow-auto">
        {/* The dashboard lays out three panels side by side; one event's
            triggers are prose, and prose needs a measure. */}
        <div
          className={cn(
            "mx-auto w-full px-4 pb-8 pt-6 sm:px-6",
            selectedId === null ? "max-w-[1200px]" : "max-w-[880px] sm:pt-16"
          )}
        >
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : selectedId === null ? (
            <>
              <PageHeader
                title="Alerts"
                description="How your alerts have been going, and a way to fire one yourself. Pick a kind of event on the left to configure what it does."
              />
              <AlertsDashboard sections={sections} />
            </>
          ) : !node ? (
            <EmptyState
              icon={Bell}
              title="No such event type"
              description="Nothing registered reports this kind of event. It may have come from a module that is no longer installed."
              action={{ label: "Back to alerts", onClick: () => navigate(BASE_PATH) }}
            />
          ) : (
            <div className="flex flex-col gap-16">
              {nodePresets.length > 1 && (
                <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">{nodeTrail}</h1>
              )}
              {nodePresets.map((preset) => (
                <EventWorkflowEditor
                  key={preset.id}
                  triggerPreset={preset}
                  actionPresets={actionPresets}
                  workflows={rows}
                  breadcrumb={nodePresets.length > 1 ? [] : breadcrumb}
                  headingLevel={nodePresets.length > 1 ? "h2" : "h1"}
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

/** The page's #hash without the #, or null when it has none. */
function currentHash(): string | null {
  const hash = window.location.hash.slice(1);
  return hash ? decodeSegment(hash) : null;
}

/** A URL path segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
