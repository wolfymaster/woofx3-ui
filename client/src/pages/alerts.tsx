import { useStore } from "@nanostores/react";
import { Bell, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertGroupRail } from "@/components/alerts/alert-group-rail";
import { AlertsDashboard } from "@/components/alerts/dashboard/alerts-dashboard";
import { EventTriggerList } from "@/components/alerts/event-trigger-list";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { TestEventSheet } from "@/components/test-events/test-event-sheet";
import { useWorkflows } from "@/engine/hooks/use-workflows";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import {
  alertMenuPath,
  alertNodeId,
  buildAlertTree,
  countAlertsByNode,
  findAlertNode,
  flattenAlertTree,
  pruneUnusedAlerts,
  subtreePresets,
  taxonomyLabel,
} from "@/lib/alert-groups";
import { eventTriggers } from "@/lib/alert-triggers";
import { decodeSegment, subPathSegments } from "@/lib/route-subpath";
import { $hideUnusedAlerts } from "@/lib/stores";
import { cn } from "@/lib/utils";

const BASE_PATH = "/stream/alerts";

/**
 * Triggers, grouped by platform and then by what happened.
 *
 * Each configured trigger is a workflow of its own on its event, so this screen reads the
 * engine's own records — see lib/alert-triggers.ts. Nothing is stored here.
 */
export default function Alerts() {
  const [location, navigate] = useLocation();
  const { triggerPresets, loading: catalogLoading } = useWorkflowCatalog();
  const workflows = useWorkflows();

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
  const rows = useMemo(() => workflows ?? [], [workflows]);
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

  // Paused triggers count: pausing is not deleting, and the rail must still lead to a
  // paused alert so it can be resumed.
  const { counts, configuredEvents } = useMemo(() => {
    const perEvent: [string[], number][] = [];
    const events = new Set<string>();
    for (const [event, path] of menuPathByEvent) {
      const triggers = eventTriggers(rows, event).length;
      if (triggers > 0) {
        perEvent.push([path, triggers]);
        events.add(event);
      }
    }
    return { counts: countAlertsByNode(perEvent), configuredEvents: events };
  }, [rows, menuPathByEvent]);

  // Everything below the Alerts route is the selected menu path, as deep as the taxonomy nests.
  const selectedPath = useMemo(() => subPathSegments(location, BASE_PATH), [location]);
  const selectedId = selectedPath.length > 0 ? alertNodeId(selectedPath) : null;
  const node = selectedId === null ? undefined : findAlertNode(tree, selectedPath);
  const nodePresets = node ? subtreePresets(node) : [];
  // A leaf label alone does not say which entry this is once a segment repeats at
  // two depths — `alert.subscription.gift` and `alert.shared.subscription.gift`
  // both end in "Gift" — so the title names the whole trail, as the rail shows it.
  const nodeTrail = node ? selectedPath.map(taxonomyLabel).join(" › ") : null;
  // A lone event's title is its own name, so the trail above it stops at its parent.
  const breadcrumb = selectedPath.slice(0, -1).map(taxonomyLabel);

  // Only the rail is pruned: routing, the dashboard and the test sheet read the full
  // tree, so hiding an entry never stops its URL resolving. Nothing is pruned before
  // the workflows arrive, or the rail would flash empty and then fill in.
  const hideUnused = useStore($hideUnusedAlerts);
  const railTree = useMemo(
    () =>
      hideUnused && workflows !== undefined ? pruneUnusedAlerts(tree, { counts, configuredEvents, selectedId }) : tree,
    [hideUnused, workflows, tree, counts, configuredEvents, selectedId]
  );

  // Leaving for an entry of the menu drops the jump marker, since that link has no #hash.
  useEffect(() => {
    if (selectedId !== null && currentHash() === null) {
      setActiveAnchor(null);
    }
  }, [selectedId]);

  // Waits two frames before scrolling: the sections above the target must reach their
  // full height first, which their option lists settle in effects, or it lands short.
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
        tree={railTree}
        counts={counts}
        selectedId={selectedId}
        basePath={BASE_PATH}
        activeAnchor={activeAnchor}
        onAnchorSelect={requestScroll}
        hideUnused={hideUnused}
        onHideUnusedChange={(hide) => $hideUnusedAlerts.set(hide)}
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
                <EventTriggerList
                  key={preset.id}
                  triggerPreset={preset}
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
