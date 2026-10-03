import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { GripVertical, LayoutTemplate, Plus, X } from "lucide-react";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import { HelpTip } from "@/components/common/help-tip";
import { Card } from "@/components/ui/card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  columnWeight,
  type DashboardLayoutDefinition,
  dashboardLayouts,
  getDashboardLayout,
  rowWeight,
} from "@/lib/dashboard-layouts";
import type { DashboardPanelWidget } from "@/lib/dashboard-panels";
import { getDashboardWidget } from "@/lib/dashboard-widgets/registry";
import { type DashboardWidgetDefinition, widgetSlotId } from "@/lib/dashboard-widgets/types";
import { cn } from "@/lib/utils";

/**
 * Handlers are shared by every panel and take the panel id first, so the
 * dashboard can pass one stable function to all canvases and memoized
 * canvases, zones and slots skip re-rendering when nothing of theirs changed.
 */
export interface DashboardCanvasHandlers {
  /** Asks for a widget to put in the zone; the dashboard owns the picker. */
  onAddWidget: (panelId: string, zoneId: string) => void;
  onRemoveWidget: (panelId: string, zoneId: string, slotId: string) => void;
  /** `toIndex` counts the destination zone's widgets without the moved one. */
  onMoveWidget: (panelId: string, slotId: string, toZoneId: string, toIndex: number) => void;
  onWidgetConfigChange: (
    panelId: string,
    zoneId: string,
    slotId: string,
    type: string,
    config: Record<string, unknown>
  ) => void;
  onResizeWidgets: (panelId: string, zoneId: string, sizes: number[]) => void;
}

function LayoutPreview({ layout }: { layout: DashboardLayoutDefinition }) {
  return (
    <div className="flex flex-col gap-1 w-full h-16">
      {layout.rows.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are a static, never-reordered layout definition
        <div key={`row-${rowIndex}`} className="flex gap-1" style={{ flexGrow: rowWeight(row), flexBasis: 0 }}>
          {Array.from({ length: row.columns }).map((_, columnIndex) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are a static, never-reordered layout definition
              key={`col-${columnIndex}`}
              className="rounded bg-muted border border-border"
              style={{ flexGrow: columnWeight(row, columnIndex), flexBasis: 0 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface DashboardLayoutPickerProps {
  onSelect: (layoutId: string) => void;
}

export function DashboardLayoutPicker({ onSelect }: DashboardLayoutPickerProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="text-center max-w-md mb-8">
        <LayoutTemplate className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h2 className="flex items-center justify-center gap-1.5 text-xl font-semibold mb-2">
          Choose a Dashboard Layout
          <HelpTip term="panel" align="center" />
        </h2>
        <p className="text-muted-foreground">
          Pick the arrangement of widget areas for this page. A page keeps the layout it was created with — to use a
          different one, delete the page and add a new one.{" "}
          <HelpTip term="zone" align="center" className="align-middle" />
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {dashboardLayouts.map((layout) => (
          <Card
            key={layout.id}
            role="button"
            tabIndex={0}
            className="p-4 flex flex-col items-center gap-3 cursor-pointer hover:border-primary transition-colors"
            onClick={() => onSelect(layout.id)}
            data-testid={`layout-option-${layout.id}`}
          >
            <LayoutPreview layout={layout} />
            <span className="text-sm font-medium">{layout.name}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Where a dragged widget would land: before `beforeSlotId`, or at the zone's end when it is null. */
interface DropTarget {
  zoneId: string;
  index: number;
  beforeSlotId: string | null;
}

type DropData = { kind: "slot"; zoneId: string; slotId: string } | { kind: "zone"; zoneId: string };

const SLOT_DROP_PREFIX = "slot:";
const ZONE_DROP_PREFIX = "zone:";

/**
 * A slot sits inside its zone's drop area, so the pointer is usually within
 * both. The slot wins, since it says where in the stack to land; the zone
 * only catches drops on an empty zone.
 */
const slotsBeforeZones: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const slot = collisions.find((collision) => String(collision.id).startsWith(SLOT_DROP_PREFIX));
  if (slot) {
    return [slot];
  }
  return collisions.filter((collision) => String(collision.id).startsWith(ZONE_DROP_PREFIX)).slice(0, 1);
};

function pointerClientY(event: DragMoveEvent | DragEndEvent): number | null {
  const activator = event.activatorEvent;
  if (activator instanceof MouseEvent) {
    return activator.clientY + event.delta.y;
  }
  if (typeof TouchEvent !== "undefined" && activator instanceof TouchEvent && activator.touches.length > 0) {
    return activator.touches[0].clientY + event.delta.y;
  }
  return null;
}

/** Holding still briefly before a touch drag lets a swipe still scroll the page. */
function useWidgetDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } })
  );
}

interface WidgetSlotProps {
  panelId: string;
  zoneId: string;
  widget: DashboardPanelWidget;
  isEditing: boolean;
  /** A dragged widget would land just above this one. */
  isDropBefore: boolean;
  onRemoveWidget: DashboardCanvasHandlers["onRemoveWidget"];
  onWidgetConfigChange: DashboardCanvasHandlers["onWidgetConfigChange"];
}

/**
 * Edit mode lays its controls over the widget instead of adding a row to it,
 * so every widget keeps the exact size it has outside edit mode and the
 * layout being edited is the layout that gets saved. The cover also keeps a
 * stray click from acting on the live widget while rearranging, and makes the
 * whole widget the drag handle.
 */
function EditCover({
  slotId,
  zoneId,
  label,
  icon: Icon,
  onRemove,
}: {
  slotId: string;
  zoneId: string;
  label: string;
  icon?: DashboardWidgetDefinition["icon"];
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: slotId, data: { zoneId } });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "absolute inset-0 z-10 flex cursor-grab touch-none items-center justify-center bg-background/55 ring-1 ring-inset ring-primary/30 backdrop-blur-[1px] active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
      data-testid={`edit-cover-${slotId}`}
    >
      <span className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
        {label}
      </span>
      <button
        type="button"
        // Keeps the press from starting a drag of the widget being removed.
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-destructive"
        aria-label={`Remove ${label}`}
        data-testid={`button-remove-widget-${slotId}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const WidgetSlot = memo(function WidgetSlot({
  panelId,
  zoneId,
  widget,
  isEditing,
  isDropBefore,
  onRemoveWidget,
  onWidgetConfigChange,
}: WidgetSlotProps) {
  const entry = getDashboardWidget(widget.type);
  const Component = entry?.component;
  const slotId = widgetSlotId(widget);
  const widgetType = widget.type;
  const dropData: DropData = { kind: "slot", zoneId, slotId };
  const { setNodeRef } = useDroppable({ id: `${SLOT_DROP_PREFIX}${slotId}`, data: dropData, disabled: !isEditing });

  const onRemove = useCallback(() => {
    onRemoveWidget(panelId, zoneId, slotId);
  }, [onRemoveWidget, panelId, zoneId, slotId]);
  const onConfigChange = useCallback(
    (config: Record<string, unknown>) => {
      onWidgetConfigChange(panelId, zoneId, slotId, widgetType, config);
    },
    [onWidgetConfigChange, panelId, zoneId, slotId, widgetType]
  );

  // Transparent: the surface belongs to the zone, so stacked widgets sit on one
  // background instead of butting two bordered cards together. The resize
  // handle between them is the rule that separates them.
  return (
    <div ref={setNodeRef} className="relative h-full overflow-hidden" data-testid={`widget-slot-${slotId}`}>
      {Component ? (
        <Component config={widget.config} onConfigChange={onConfigChange} />
      ) : (
        <div className="h-full flex items-center justify-center p-3 text-center text-sm text-muted-foreground">
          Unknown widget type: {widget.type}
        </div>
      )}
      {isEditing && (
        <EditCover
          slotId={slotId}
          zoneId={zoneId}
          label={entry?.label ?? widget.type}
          icon={entry?.icon}
          onRemove={onRemove}
        />
      )}
      {isDropBefore && <div className="absolute inset-x-2 top-0 z-20 h-0.5 rounded-full bg-primary" />}
    </div>
  );
});

interface DashboardZoneProps {
  panelId: string;
  zoneId: string;
  widgets: DashboardPanelWidget[];
  /** Share of the row's width, relative to the row's other zones. */
  widthWeight: number;
  isEditing: boolean;
  /** Set only while a dragged widget would land in this zone: before that slot, or at the end when null. */
  dropBeforeSlotId: string | null | undefined;
  onAddWidget: DashboardCanvasHandlers["onAddWidget"];
  onRemoveWidget: DashboardCanvasHandlers["onRemoveWidget"];
  onWidgetConfigChange: DashboardCanvasHandlers["onWidgetConfigChange"];
  onResizeWidgets: DashboardCanvasHandlers["onResizeWidgets"];
}

const DashboardZone = memo(function DashboardZone({
  panelId,
  zoneId,
  widgets,
  widthWeight,
  isEditing,
  dropBeforeSlotId,
  onAddWidget,
  onRemoveWidget,
  onWidgetConfigChange,
  onResizeWidgets,
}: DashboardZoneProps) {
  const dropData: DropData = { kind: "zone", zoneId };
  const { setNodeRef } = useDroppable({ id: `${ZONE_DROP_PREFIX}${zoneId}`, data: dropData, disabled: !isEditing });
  const addToZone = useCallback(() => {
    onAddWidget(panelId, zoneId);
  }, [onAddWidget, panelId, zoneId]);
  const resizeZone = useCallback(
    (sizes: number[]) => {
      onResizeWidgets(panelId, zoneId, sizes);
    },
    [onResizeWidgets, panelId, zoneId]
  );

  const growStyle = { flexGrow: widthWeight, flexBasis: 0 };
  const isDropTarget = dropBeforeSlotId !== undefined;

  if (widgets.length === 0) {
    if (!isEditing) {
      return <div style={growStyle} data-testid={`canvas-zone-${zoneId}`} />;
    }

    return (
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-lg border-2 border-dashed flex items-center justify-center transition-colors",
          isDropTarget ? "border-primary bg-primary/5" : "border-border"
        )}
        style={growStyle}
        data-testid={`canvas-zone-${zoneId}`}
      >
        <button
          type="button"
          onClick={addToZone}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          data-testid={`button-add-widget-${zoneId}`}
        >
          <Plus className="h-4 w-4" />
          Add Widget
        </button>
      </div>
    );
  }

  const panelChildren: ReactNode[] = [];
  widgets.forEach((widget, index) => {
    const slotId = widgetSlotId(widget);
    if (index > 0) {
      // Always rendered, and only draggable while editing, so the rule between
      // stacked widgets takes the same pixel in and out of edit mode.
      panelChildren.push(<ResizableHandle key={`handle-${slotId}`} withHandle={isEditing} disabled={!isEditing} />);
    }
    panelChildren.push(
      <ResizablePanel key={slotId} defaultSize={widget.size ?? 100 / widgets.length} minSize={10}>
        <WidgetSlot
          panelId={panelId}
          zoneId={zoneId}
          widget={widget}
          isEditing={isEditing}
          isDropBefore={dropBeforeSlotId === slotId}
          onRemoveWidget={onRemoveWidget}
          onWidgetConfigChange={onWidgetConfigChange}
        />
      </ResizablePanel>
    );
  });

  return (
    <div
      ref={setNodeRef}
      className="relative flex flex-col min-h-0"
      style={growStyle}
      data-testid={`canvas-zone-${zoneId}`}
    >
      <ResizablePanelGroup
        direction="vertical"
        className={cn(
          "flex-1 min-h-0 rounded-lg border bg-card overflow-hidden transition-colors",
          isDropTarget ? "border-primary" : "border-border"
        )}
        onLayout={isEditing ? resizeZone : undefined}
      >
        {panelChildren}
      </ResizablePanelGroup>
      {dropBeforeSlotId === null && <div className="absolute inset-x-2 bottom-px z-20 h-0.5 rounded-full bg-primary" />}
      {isEditing && (
        // Floats over the zone's last widget rather than sitting under the zone,
        // which would shorten the zone for as long as edit mode is on.
        <button
          type="button"
          onClick={addToZone}
          className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm hover:text-foreground"
          data-testid={`button-add-widget-${zoneId}`}
        >
          <Plus className="h-3 w-3" />
          Add Widget
        </button>
      )}
    </div>
  );
});

/** Shared so an empty zone's props compare equal between renders. */
const NO_WIDGETS: DashboardPanelWidget[] = [];

interface DashboardCanvasProps extends DashboardCanvasHandlers {
  panelId: string;
  layoutId: string;
  /** The panel's saved widgets, or its edit-mode draft. */
  widgets: DashboardPanelWidget[];
  isEditing: boolean;
}

export const DashboardCanvas = memo(function DashboardCanvas({
  panelId,
  layoutId,
  widgets,
  isEditing,
  onAddWidget,
  onRemoveWidget,
  onMoveWidget,
  onWidgetConfigChange,
  onResizeWidgets,
}: DashboardCanvasProps) {
  const layout = getDashboardLayout(layoutId);
  const sensors = useWidgetDragSensors();
  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const widgetsByZone = useMemo(() => {
    const byZone = new Map<string, DashboardPanelWidget[]>();
    for (const widget of widgets) {
      const zoneWidgets = byZone.get(widget.zoneId);
      if (zoneWidgets) {
        zoneWidgets.push(widget);
      } else {
        byZone.set(widget.zoneId, [widget]);
      }
    }
    return byZone;
  }, [widgets]);

  /** Null when the pointer is over nothing, or over the spot the widget already holds. */
  const resolveDropTarget = (event: DragMoveEvent | DragEndEvent): DropTarget | null => {
    const over = event.over;
    const data = over?.data.current as DropData | undefined;
    if (!over || !data) {
      return null;
    }
    const activeSlotId = String(event.active.id);
    const zoneWidgets = widgetsByZone.get(data.zoneId) ?? NO_WIDGETS;
    const others = zoneWidgets.map(widgetSlotId).filter((slotId) => slotId !== activeSlotId);

    let index = others.length;
    if (data.kind === "slot") {
      if (data.slotId === activeSlotId) {
        return null;
      }
      const pointerY = pointerClientY(event);
      const landsBelow = pointerY !== null && pointerY > over.rect.top + over.rect.height / 2;
      index = others.indexOf(data.slotId) + (landsBelow ? 1 : 0);
    }

    const currentIndex = zoneWidgets.findIndex((widget) => widgetSlotId(widget) === activeSlotId);
    if (currentIndex !== -1 && currentIndex === index) {
      return null;
    }
    return { zoneId: data.zoneId, index, beforeSlotId: others[index] ?? null };
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingSlotId(String(event.active.id));
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const next = resolveDropTarget(event);
    setDropTarget((prev) =>
      prev?.zoneId === next?.zoneId && prev?.index === next?.index && prev?.beforeSlotId === next?.beforeSlotId
        ? prev
        : next
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const target = resolveDropTarget(event);
    setDraggingSlotId(null);
    setDropTarget(null);
    if (target) {
      onMoveWidget(panelId, String(event.active.id), target.zoneId, target.index);
    }
  };

  const handleDragCancel = () => {
    setDraggingSlotId(null);
    setDropTarget(null);
  };

  if (!layout) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Unknown layout: {layoutId}
      </div>
    );
  }

  const draggingEntry = draggingSlotId
    ? getDashboardWidget(widgets.find((widget) => widgetSlotId(widget) === draggingSlotId)?.type ?? "")
    : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={slotsBeforeZones}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full p-4 flex flex-col gap-4">
        {layout.rows.map((row, rowIndex) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are a static, never-reordered layout definition
            key={`row-${rowIndex}`}
            className="flex gap-4 min-h-0"
            style={{ flexGrow: rowWeight(row), flexBasis: 0 }}
          >
            {Array.from({ length: row.columns }).map((_, columnIndex) => {
              const zoneId = `${rowIndex}-${columnIndex}`;
              return (
                <DashboardZone
                  key={zoneId}
                  panelId={panelId}
                  zoneId={zoneId}
                  widthWeight={columnWeight(row, columnIndex)}
                  widgets={widgetsByZone.get(zoneId) ?? NO_WIDGETS}
                  isEditing={isEditing}
                  dropBeforeSlotId={dropTarget?.zoneId === zoneId ? dropTarget.beforeSlotId : undefined}
                  onAddWidget={onAddWidget}
                  onRemoveWidget={onRemoveWidget}
                  onWidgetConfigChange={onWidgetConfigChange}
                  onResizeWidgets={onResizeWidgets}
                />
              );
            })}
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingEntry && (
          <div className="flex items-center gap-2 rounded-md border border-primary bg-card px-3 py-2 text-xs font-medium shadow-lg">
            <draggingEntry.icon className="h-3.5 w-3.5 text-primary" />
            {draggingEntry.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
});
