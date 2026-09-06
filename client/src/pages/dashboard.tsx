import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useStore } from "@nanostores/react";
import { useMutation, useQuery } from "convex/react";
import { Check, LayoutGrid, Loader2, PanelTop, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CommandBar } from "@/components/dashboard/command-bar";
import { DashboardCanvas, DashboardLayoutPicker } from "@/components/dashboard/dashboard-canvas";
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
import { Button } from "@/components/ui/button";
import { Carousel, type CarouselApi, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInstance } from "@/hooks/use-instance";
import { widgetSlotId } from "@/lib/dashboard-widgets/types";
import { $commandBarHidden } from "@/lib/stores";
import { cn } from "@/lib/utils";

type DashboardPanel = NonNullable<Doc<"dashboardLayouts">["panels"]>[number];
type DashboardPanelWidget = DashboardPanel["widgets"][number];

export default function Dashboard() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const commandBarHidden = useStore($commandBarHidden);

  const panels = useQuery(api.dashboardLayouts.getPanels, instance ? { instanceId: instance._id } : "skip");
  const addPanel = useMutation(api.dashboardLayouts.addPanel);
  const removePanel = useMutation(api.dashboardLayouts.removePanel);
  const renamePanel = useMutation(api.dashboardLayouts.renamePanel);
  const setPanelWidgets = useMutation(api.dashboardLayouts.setPanelWidgets);

  const [isEditing, setIsEditing] = useState(false);
  const [draftWidgets, setDraftWidgets] = useState<Record<string, DashboardPanelWidget[]> | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [renamingPanelId, setRenamingPanelId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const wheelCooldownRef = useRef(false);

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

  const isLoading = instanceLoading || (!!instance && panels === undefined);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
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

  const handleSelectTab = (value: string) => {
    const index = Number(value);
    setActiveIndex(index);
    carouselApi?.scrollTo(index);
  };

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

  const startRenamingPanel = (panelId: string, currentName: string) => {
    setRenamingPanelId(panelId);
    setRenameValue(currentName);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  const commitRenamePanel = async (panelId: string) => {
    setRenamingPanelId(null);
    const trimmed = renameValue.trim();
    const panel = panels.find((p) => p.id === panelId);
    if (!trimmed || !panel || trimmed === panel.name) {
      return;
    }
    await renamePanel({ instanceId: instance._id, panelId, name: trimmed });
  };

  const enterEditMode = () => {
    const snapshot: Record<string, DashboardPanelWidget[]> = {};
    for (const panel of panels) {
      snapshot[panel.id] = panel.widgets;
    }
    setDraftWidgets(snapshot);
    setIsEditing(true);
  };

  const handleCancelEdits = () => {
    setDraftWidgets(null);
    setIsEditing(false);
  };

  const handleSaveEdits = async () => {
    if (draftWidgets) {
      const currentPanelIds = new Set(panels.map((panel) => panel.id));
      await Promise.all(
        Object.entries(draftWidgets)
          .filter(([panelId]) => currentPanelIds.has(panelId))
          .map(([panelId, widgets]) => setPanelWidgets({ instanceId: instance._id, panelId, widgets }))
      );
    }
    setDraftWidgets(null);
    setIsEditing(false);
  };

  const setDraftWidgetsForPanel = (panelId: string, widgets: DashboardPanelWidget[]) => {
    setDraftWidgets((prev) => ({ ...prev, [panelId]: widgets }));
  };

  // Zones can hold more than one widget now (stacked, resizable), so
  // add/remove keep the rest of that zone's widgets evenly re-split — only
  // an explicit drag (handleResizeWidgets) sets custom sizes after that.
  const handleAssignWidget = (
    panelId: string,
    currentWidgets: DashboardPanelWidget[],
    zoneId: string,
    type: string
  ) => {
    const otherWidgets = currentWidgets.filter((widget) => widget.zoneId !== zoneId);
    const zoneWidgets = currentWidgets.filter((widget) => widget.zoneId === zoneId);
    const evenSize = 100 / (zoneWidgets.length + 1);
    const resizedZoneWidgets = zoneWidgets.map((widget) => ({ ...widget, size: evenSize }));
    const newWidget: DashboardPanelWidget = { zoneId, slotId: crypto.randomUUID(), type, size: evenSize };
    setDraftWidgetsForPanel(panelId, [...otherWidgets, ...resizedZoneWidgets, newWidget]);
  };

  const handleRemoveWidget = (
    panelId: string,
    currentWidgets: DashboardPanelWidget[],
    zoneId: string,
    slotId: string
  ) => {
    const otherWidgets = currentWidgets.filter((widget) => widget.zoneId !== zoneId);
    const remainingZoneWidgets = currentWidgets.filter(
      (widget) => widget.zoneId === zoneId && widgetSlotId(widget) !== slotId
    );
    const evenSize = remainingZoneWidgets.length > 0 ? 100 / remainingZoneWidgets.length : undefined;
    const resizedZoneWidgets = remainingZoneWidgets.map((widget) => ({ ...widget, size: evenSize }));
    setDraftWidgetsForPanel(panelId, [...otherWidgets, ...resizedZoneWidgets]);
  };

  const handleWidgetConfigChange = (
    panelId: string,
    currentWidgets: DashboardPanelWidget[],
    zoneId: string,
    slotId: string,
    type: string,
    config: Record<string, unknown>
  ) => {
    const widgets = currentWidgets.map((widget) =>
      widget.zoneId === zoneId && widgetSlotId(widget) === slotId ? { ...widget, type, config } : widget
    );
    setDraftWidgetsForPanel(panelId, widgets);
  };

  const handleResizeWidgets = (
    panelId: string,
    currentWidgets: DashboardPanelWidget[],
    zoneId: string,
    sizes: number[]
  ) => {
    let index = 0;
    const widgets = currentWidgets.map((widget) => {
      if (widget.zoneId !== zoneId) {
        return widget;
      }
      const size = sizes[index];
      index += 1;
      return size == null ? widget : { ...widget, size };
    });
    setDraftWidgetsForPanel(panelId, widgets);
  };

  return (
    <div className="h-full flex flex-col">
      <StatusBarCenterPortal>
        <Tabs value={String(activeIndex)} onValueChange={handleSelectTab}>
          <TabsList className="h-6 p-0.5 bg-transparent">
            {panels.map((panel, index) =>
              renamingPanelId === panel.id ? (
                <input
                  key={panel.id}
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRenamePanel(panel.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRenamePanel(panel.id);
                    } else if (e.key === "Escape") {
                      setRenamingPanelId(null);
                    }
                  }}
                  className="h-5 w-20 px-2 rounded-sm bg-background border border-primary text-[11px] outline-none"
                  data-testid={`input-rename-panel-${panel.id}`}
                />
              ) : (
                <ContextMenu key={panel.id}>
                  <ContextMenuTrigger asChild>
                    <TabsTrigger
                      value={String(index)}
                      className={cn(
                        "h-5 px-2 text-[11px]",
                        // ContextMenuTrigger's asChild also writes `data-state` (open/closed) onto
                        // this same element, clobbering the Tabs primitive's own active/inactive
                        // data-state — so drive the active style from React state instead.
                        index === activeIndex && "bg-muted text-foreground shadow-sm"
                      )}
                      data-testid={`tab-panel-${panel.id}`}
                    >
                      {panel.name}
                    </TabsTrigger>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    {!isEditing && (
                      <>
                        <ContextMenuItem onClick={enterEditMode} data-testid="button-toggle-edit">
                          <LayoutGrid className="h-3.5 w-3.5 mr-2" />
                          Edit
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                      </>
                    )}
                    {commandBarHidden && (
                      <>
                        <ContextMenuItem
                          onClick={() => $commandBarHidden.set(false)}
                          data-testid="button-show-command-bar"
                        >
                          <PanelTop className="h-3.5 w-3.5 mr-2" />
                          Show Command Bar
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                      </>
                    )}
                    <ContextMenuItem
                      onClick={() => startRenamingPanel(panel.id, panel.name)}
                      data-testid={`button-rename-panel-${panel.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-2" />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => setAddPanelOpen(true)} data-testid="button-add-panel">
                      <Plus className="h-3.5 w-3.5 mr-2" />
                      Add Panel
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => setRemoveTarget({ id: panel.id, name: panel.name })}
                      disabled={panels.length <= 1}
                      className="text-destructive focus:text-destructive"
                      data-testid={`button-remove-panel-${panel.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            )}
          </TabsList>
        </Tabs>
      </StatusBarCenterPortal>

      {isEditing && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={handleCancelEdits} data-testid="button-cancel-edit">
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSaveEdits()} data-testid="button-save-edit">
            <Check className="h-4 w-4 mr-2" />
            Save
          </Button>
        </div>
      )}

      {!commandBarHidden && <CommandBar onDismiss={() => $commandBarHidden.set(true)} />}

      <Carousel className="flex-1 min-h-0" setApi={setCarouselApi}>
        <CarouselContent>
          {panels.map((panel) => {
            const currentWidgets = (isEditing && draftWidgets?.[panel.id]) || panel.widgets;
            const effectivePanel = isEditing ? { ...panel, widgets: currentWidgets } : panel;

            return (
              <CarouselItem key={panel.id} className="h-full pl-0">
                <DashboardCanvas
                  panel={effectivePanel}
                  isEditing={isEditing}
                  onAssignWidget={(zoneId, type) => handleAssignWidget(panel.id, currentWidgets, zoneId, type)}
                  onRemoveWidget={(zoneId, slotId) => handleRemoveWidget(panel.id, currentWidgets, zoneId, slotId)}
                  onWidgetConfigChange={(zoneId, slotId, type, config) =>
                    handleWidgetConfigChange(panel.id, currentWidgets, zoneId, slotId, type, config)
                  }
                  onResizeWidgets={(zoneId, sizes) => handleResizeWidgets(panel.id, currentWidgets, zoneId, sizes)}
                />
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>

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
  );
}
