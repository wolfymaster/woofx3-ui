import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useMutation } from "convex/react";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandBar } from "@/components/dashboard/command-bar";
import { DashboardCanvas, DashboardLayoutPicker } from "@/components/dashboard/dashboard-canvas";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { GettingStartedCard } from "@/components/dashboard/getting-started-card";
import { PanelTabs } from "@/components/dashboard/panel-tabs";
import { StarterPacksNudge } from "@/components/dashboard/starter-packs-nudge";
import { WidgetPickerDialog } from "@/components/dashboard/widget-picker-dialog";
import { WidgetRail } from "@/components/dashboard/widget-rail";
import { StatusBarCenterPortal } from "@/components/layout/status-bar-slot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Carousel, type CarouselApi, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NotRunningNotice } from "@/components/workflows/not-running-notice";
import { useInstance } from "@/hooks/use-instance";
import { useOptimisticInstanceQuery } from "@/hooks/use-optimistic-instance-query";
import { useToast } from "@/hooks/use-toast";
import {
  assignWidget,
  configureWidget,
  type DashboardPanelWidget,
  isPanelMounted,
  moveWidget,
  removeWidget,
  resizeZone,
} from "@/lib/dashboard-panels";
import {
  addRailWidget,
  configureRailWidget,
  type DashboardRailWidget,
  moveRailWidget,
  removeRailWidget,
  resolveRailWidgets,
} from "@/lib/dashboard-rail";
import { $commandBarHidden, $dashboardLayoutHint } from "@/lib/stores";

/** Where a widget chosen in the picker goes. */
type PickerTarget = { kind: "zone"; panelId: string; zoneId: string } | { kind: "rail" };

export default function Dashboard() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const commandBarHidden = useStore($commandBarHidden);

  const layoutHint = useStore($dashboardLayoutHint);
  // Starts with the cached instance id, alongside the membership list; the
  // result is only rendered once `instance` confirms that id.
  const panels = useOptimisticInstanceQuery(api.dashboardLayouts.getPanels);
  const savedRail = useOptimisticInstanceQuery(api.dashboardLayouts.getRailWidgets);
  const addPanel = useMutation(api.dashboardLayouts.addPanel);
  const removePanel = useMutation(api.dashboardLayouts.removePanel);
  const renamePanel = useMutation(api.dashboardLayouts.renamePanel);
  const setPanelWidgets = useMutation(api.dashboardLayouts.setPanelWidgets);
  const setRailWidgets = useMutation(api.dashboardLayouts.setRailWidgets);
  const { toast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draftWidgets, setDraftWidgets] = useState<Record<string, DashboardPanelWidget[]> | null>(null);
  const [draftRail, setDraftRail] = useState<DashboardRailWidget[] | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const wheelCooldownRef = useRef(false);

  const instanceId = instance?._id;
  // Read by the stable handlers below. Convex hands back a new panels array on
  // every change, and depending on it would give every canvas new handlers too.
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const railWidgets = resolveRailWidgets(savedRail);
  const railRef = useRef(railWidgets);
  railRef.current = railWidgets;

  useEffect(() => {
    if (!carouselApi) {
      return;
    }
    const onSelect = () => setActiveIndex(carouselApi.selectedScrollSnap());
    carouselApi.on("select", onSelect);
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi]);

  // Mouse-wheel/trackpad navigation — one pane per gesture, same jump the tabs
  // do (not a free-scrolling drag), and no native scrollbar since Embla moves
  // panes via transform rather than actual overflow scrolling.
  useEffect(() => {
    if (!carouselApi) {
      return;
    }
    const container = carouselApi.rootNode();

    // True if some scrollable ancestor of `target` (up to `container`, e.g. a
    // widget's internal chat/list scroll area) still has room to consume this
    // vertical scroll — if so we back off and let it scroll normally instead
    // of hijacking the gesture for pane navigation.
    const verticalScrollHandledByAncestor = (target: EventTarget | null, deltaY: number): boolean => {
      let node = target instanceof HTMLElement ? target : null;
      while (node && node !== container) {
        const style = getComputedStyle(node);
        const canScrollY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
        if (canScrollY) {
          const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
          const atTop = node.scrollTop <= 0;
          if ((deltaY > 0 && !atBottom) || (deltaY < 0 && !atTop)) {
            return true;
          }
        }
        node = node.parentElement;
      }
      return false;
    };

    const handleWheel = (event: WheelEvent) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = horizontal ? event.deltaX : event.deltaY;
      if (Math.abs(delta) < 10) {
        return;
      }
      if (!horizontal && verticalScrollHandledByAncestor(event.target, delta)) {
        return;
      }
      event.preventDefault();
      if (wheelCooldownRef.current) {
        return;
      }
      wheelCooldownRef.current = true;
      if (delta > 0) {
        carouselApi.scrollNext();
      } else {
        carouselApi.scrollPrev();
      }
      setTimeout(() => {
        wheelCooldownRef.current = false;
      }, 500);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [carouselApi]);

  useEffect(() => {
    if (panels && activeIndex >= panels.length) {
      setActiveIndex(Math.max(0, panels.length - 1));
    }
  }, [panels, activeIndex]);

  const handleSelectTab = useCallback(
    (index: number) => {
      setActiveIndex(index);
      carouselApi?.scrollTo(index);
    },
    [carouselApi]
  );

  const handleRenamePanel = useCallback(
    (panelId: string, name: string) => {
      if (!instanceId) {
        return;
      }
      void renamePanel({ instanceId, panelId, name });
    },
    [instanceId, renamePanel]
  );

  const openAddPanel = useCallback(() => {
    setAddPanelOpen(true);
  }, []);

  const enterEditMode = useCallback(() => {
    const snapshot: Record<string, DashboardPanelWidget[]> = {};
    for (const panel of panelsRef.current ?? []) {
      snapshot[panel.id] = panel.widgets;
    }
    setDraftWidgets(snapshot);
    setDraftRail(railRef.current);
    setIsEditing(true);
  }, []);

  /** Applies `edit` to a panel's draft, starting from its saved widgets if it has none yet. */
  const editDraft = useCallback(
    (panelId: string, edit: (widgets: DashboardPanelWidget[]) => DashboardPanelWidget[]) => {
      setDraftWidgets((prev) => {
        const current = prev?.[panelId] ?? panelsRef.current?.find((panel) => panel.id === panelId)?.widgets;
        if (!current) {
          return prev;
        }
        const next = edit(current);
        if (next === current) {
          return prev;
        }
        return { ...prev, [panelId]: next };
      });
    },
    []
  );

  const handleAddWidget = useCallback((panelId: string, zoneId: string) => {
    setPickerTarget({ kind: "zone", panelId, zoneId });
  }, []);

  const handleAddRailWidget = useCallback(() => {
    setPickerTarget({ kind: "rail" });
  }, []);

  const handlePickWidget = (type: string) => {
    if (!pickerTarget) {
      return;
    }
    // Minted outside the updater, which React may call twice.
    const slotId = crypto.randomUUID();
    if (pickerTarget.kind === "rail") {
      setDraftRail((prev) => addRailWidget(prev ?? railRef.current, type, slotId));
      return;
    }
    const { panelId, zoneId } = pickerTarget;
    editDraft(panelId, (widgets) => assignWidget(widgets, zoneId, type, slotId));
  };

  const handleMoveWidget = useCallback(
    (panelId: string, slotId: string, toZoneId: string, toIndex: number) => {
      editDraft(panelId, (widgets) => moveWidget(widgets, slotId, toZoneId, toIndex));
    },
    [editDraft]
  );

  const handleRemoveRailWidget = useCallback((slotId: string) => {
    setDraftRail((prev) => removeRailWidget(prev ?? railRef.current, slotId));
  }, []);

  const handleMoveRailWidget = useCallback((slotId: string, toIndex: number) => {
    setDraftRail((prev) => moveRailWidget(prev ?? railRef.current, slotId, toIndex));
  }, []);

  const handleRailConfigChange = useCallback(
    (slotId: string, config: Record<string, unknown>) => {
      if (isEditing) {
        setDraftRail((prev) => configureRailWidget(prev ?? railRef.current, slotId, config));
        return;
      }
      // Same reason as handleWidgetConfigChange: nothing will Save this later.
      if (!instanceId) {
        return;
      }
      void setRailWidgets({ instanceId, widgets: configureRailWidget(railRef.current, slotId, config) });
    },
    [isEditing, instanceId, setRailWidgets]
  );

  const handleRemoveWidget = useCallback(
    (panelId: string, zoneId: string, slotId: string) => {
      editDraft(panelId, (widgets) => removeWidget(widgets, zoneId, slotId));
    },
    [editDraft]
  );

  const handleResizeWidgets = useCallback(
    (panelId: string, zoneId: string, sizes: number[]) => {
      editDraft(panelId, (widgets) => resizeZone(widgets, zoneId, sizes));
    },
    [editDraft]
  );

  const handleWidgetConfigChange = useCallback(
    (panelId: string, zoneId: string, slotId: string, type: string, config: Record<string, unknown>) => {
      if (isEditing) {
        editDraft(panelId, (widgets) => configureWidget(widgets, zoneId, slotId, type, config));
        return;
      }
      // Outside edit mode there is no draft anyone will later Save, so a widget's
      // own settings (a macro added to the pad, a reordered button) have to reach
      // Convex now or they are lost on the next load.
      const panel = panelsRef.current?.find((candidate) => candidate.id === panelId);
      if (!instanceId || !panel) {
        return;
      }
      void setPanelWidgets({
        instanceId,
        panelId,
        widgets: configureWidget(panel.widgets, zoneId, slotId, type, config),
      });
    },
    [isEditing, editDraft, instanceId, setPanelWidgets]
  );

  const firstLayoutId = instance && panels && panels.length > 0 ? panels[0].layoutId : null;
  useEffect(() => {
    if (firstLayoutId) {
      $dashboardLayoutHint.set(firstLayoutId);
    }
  }, [firstLayoutId]);

  const isLoading = instanceLoading || (!!instance && panels === undefined);

  if (isLoading) {
    return <DashboardSkeleton layoutId={layoutHint} />;
  }

  if (!instance || !panels || panels.length === 0) {
    return (
      <DashboardLayoutPicker
        onSelect={(layoutId) => {
          if (instance) {
            void addPanel({ instanceId: instance._id, layoutId });
          }
        }}
      />
    );
  }

  const handleAddPanel = async (layoutId: string) => {
    const panelCountBeforeAdd = panels.length;
    await addPanel({ instanceId: instance._id, layoutId });
    setAddPanelOpen(false);
    requestAnimationFrame(() => carouselApi?.scrollTo(panelCountBeforeAdd));
  };

  const handleConfirmRemovePanel = async () => {
    if (!removeTarget) {
      return;
    }
    await removePanel({ instanceId: instance._id, panelId: removeTarget.id });
    setRemoveTarget(null);
  };

  const handleCancelEdits = () => {
    setDraftWidgets(null);
    setDraftRail(null);
    setIsEditing(false);
  };

  const handleSaveEdits = async () => {
    const currentPanelIds = new Set(panels.map((panel) => panel.id));
    const writes: Promise<unknown>[] = Object.entries(draftWidgets ?? {})
      .filter(([panelId, widgets]) => {
        const saved = panels.find((panel) => panel.id === panelId)?.widgets;
        return currentPanelIds.has(panelId) && widgets !== saved;
      })
      .map(([panelId, widgets]) => setPanelWidgets({ instanceId: instance._id, panelId, widgets }));
    if (draftRail && draftRail !== railWidgets) {
      writes.push(setRailWidgets({ instanceId: instance._id, widgets: draftRail }));
    }

    setIsSaving(true);
    try {
      await Promise.all(writes);
      setDraftWidgets(null);
      setDraftRail(null);
      setIsEditing(false);
    } catch (error) {
      // Stays in edit mode with the draft intact, so nothing is lost to a retry.
      toast({
        title: "Couldn't save the dashboard",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 flex flex-col">
        <StatusBarCenterPortal>
          <PanelTabs
            panels={panels}
            activeIndex={activeIndex}
            isEditing={isEditing}
            isSaving={isSaving}
            onSelect={handleSelectTab}
            onEnterEdit={enterEditMode}
            onSaveEdit={() => void handleSaveEdits()}
            onCancelEdit={handleCancelEdits}
            onRename={handleRenamePanel}
            onAddPanel={openAddPanel}
            onRemovePanel={setRemoveTarget}
          />
        </StatusBarCenterPortal>

        {/* First, directly under the app header: until setup is done it is the
            most important thing on the page. */}
        <GettingStartedCard instanceId={instance._id} />
        <NotRunningNotice />

        {!commandBarHidden && <CommandBar onDismiss={() => $commandBarHidden.set(true)} />}
        <StarterPacksNudge instanceId={instance._id} />

        {/* Swiping between panels is off while editing, so dragging a widget
            does not also drag the carousel. */}
        <Carousel className="flex-1 min-h-0" setApi={setCarouselApi} opts={{ watchDrag: !isEditing }}>
          <CarouselContent>
            {panels.map((panel, index) => (
              // Every slide keeps its item so Embla's geometry is unchanged; only
              // panels near the selected one render widgets (see isPanelMounted).
              <CarouselItem key={panel.id} className="h-full pl-0">
                {isPanelMounted(index, activeIndex) && (
                  <DashboardCanvas
                    panelId={panel.id}
                    layoutId={panel.layoutId}
                    widgets={(isEditing && draftWidgets?.[panel.id]) || panel.widgets}
                    isEditing={isEditing}
                    onAddWidget={handleAddWidget}
                    onRemoveWidget={handleRemoveWidget}
                    onMoveWidget={handleMoveWidget}
                    onWidgetConfigChange={handleWidgetConfigChange}
                    onResizeWidgets={handleResizeWidgets}
                  />
                )}
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        <WidgetPickerDialog
          open={pickerTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPickerTarget(null);
            }
          }}
          title={pickerTarget?.kind === "rail" ? "Add a widget to the rail" : "Add a widget"}
          onSelect={handlePickWidget}
        />

        <Dialog open={addPanelOpen} onOpenChange={setAddPanelOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Add Dashboard Panel</DialogTitle>
            </DialogHeader>
            <DashboardLayoutPicker onSelect={handleAddPanel} />
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove "{removeTarget?.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the panel and any widgets placed on it. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmRemovePanel}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove Panel
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <WidgetRail
        widgets={(isEditing && draftRail) || railWidgets}
        isEditing={isEditing}
        onAddWidget={handleAddRailWidget}
        onRemoveWidget={handleRemoveRailWidget}
        onMoveWidget={handleMoveRailWidget}
        onWidgetConfigChange={handleRailConfigChange}
      />
    </div>
  );
}
