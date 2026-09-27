import { LayoutTemplate, Loader2, Plus, X } from "lucide-react";
import { memo, type ReactNode, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  columnWeight,
  type DashboardLayoutDefinition,
  dashboardLayouts,
  getDashboardLayout,
  rowWeight,
} from "@/lib/dashboard-layouts";
import type { DashboardPanelWidget } from "@/lib/dashboard-panels";
import { dashboardWidgetsByCategory, getDashboardWidget } from "@/lib/dashboard-widgets/registry";
import { widgetSlotId } from "@/lib/dashboard-widgets/types";
import { cn } from "@/lib/utils";

/**
 * Handlers are shared by every panel and take the panel id first, so the
 * dashboard can pass one stable function to all canvases and memoized
 * canvases, zones and slots skip re-rendering when nothing of theirs changed.
 */
export interface DashboardCanvasHandlers {
  onAssignWidget: (panelId: string, zoneId: string, type: string) => void;
  onRemoveWidget: (panelId: string, zoneId: string, slotId: string) => void;
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

/**
 * Zone outlines for a layout, drawn while the dashboard's panels load. Without
 * a known layout it falls back to a spinner rather than guessing a shape.
 */
export function DashboardSkeleton({ layoutId }: { layoutId: string | null }) {
  const layout = layoutId ? getDashboardLayout(layoutId) : undefined;

  if (!layout) {
    return (
      <div className="h-full flex items-center justify-center" data-testid="dashboard-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full p-4 flex flex-col gap-4" data-testid="dashboard-loading">
      {layout.rows.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are a static, never-reordered layout definition
        <div key={`row-${rowIndex}`} className="flex gap-4 min-h-0" style={{ flexGrow: rowWeight(row), flexBasis: 0 }}>
          {Array.from({ length: row.columns }).map((_, columnIndex) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are a static, never-reordered layout definition
              key={`col-${columnIndex}`}
              className="rounded-lg border border-border bg-card animate-pulse"
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
        <h2 className="text-xl font-semibold mb-2">Choose a Dashboard Layout</h2>
        <p className="text-muted-foreground">
          Pick the arrangement of widget areas for this page. A page keeps the layout it was created with — to use a
          different one, delete the page and add a new one.
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

function AddWidgetMenu({ onSelect, trigger }: { onSelect: (type: string) => void; trigger: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        {dashboardWidgetsByCategory().map(({ category, label, widgets }, groupIndex) => (
          <DropdownMenuGroup key={category}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            {widgets.map((widget) => (
              <DropdownMenuItem key={widget.type} onClick={() => onSelect(widget.type)}>
                <widget.icon className="h-4 w-4 mr-2" />
                {widget.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface WidgetSlotProps {
  panelId: string;
  zoneId: string;
  widget: DashboardPanelWidget;
  isEditing: boolean;
  /** False for every widget stacked below the first in its zone. */
  isFirst: boolean;
  onRemoveWidget: DashboardCanvasHandlers["onRemoveWidget"];
  onWidgetConfigChange: DashboardCanvasHandlers["onWidgetConfigChange"];
}

const WidgetSlot = memo(function WidgetSlot({
  panelId,
  zoneId,
  widget,
  isEditing,
  isFirst,
  onRemoveWidget,
  onWidgetConfigChange,
}: WidgetSlotProps) {
  const entry = getDashboardWidget(widget.type);
  const Component = entry?.component;
  const slotId = widgetSlotId(widget);
  const widgetType = widget.type;

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
  // background instead of butting two bordered cards together. A rule separates
  // them, since the resize handle that used to imply a boundary only renders
  // while editing.
  //
  // Both the known and unknown cases share this frame. An unknown widget used to
  // return early, before the edit-mode row was rendered, which left it with no
  // remove control at all -- so the one placement you most need to delete was
  // the one you could not.
  return (
    <div className={cn("h-full flex flex-col overflow-hidden", !isFirst && "border-t border-border")}>
      {isEditing && (
        <div className="flex items-center px-2 py-1.5 border-b border-border bg-muted/30 shrink-0">
          {/* No name here: the registry label still identifies the widget in the
              Add Widget menu, but most widgets draw their own heading, so
              printing it again only duplicated it. */}
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label={`Remove ${entry?.label ?? widget.type}`}
            data-testid={`button-remove-widget-${slotId}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        {Component ? (
          <Component config={widget.config} onConfigChange={onConfigChange} />
        ) : (
          <div className="h-full flex items-center justify-center p-3 text-center text-sm text-muted-foreground">
            Unknown widget type: {widget.type}
          </div>
        )}
      </div>
    </div>
  );
});

interface DashboardZoneProps extends DashboardCanvasHandlers {
  panelId: string;
  zoneId: string;
  widgets: DashboardPanelWidget[];
  /** Share of the row's width, relative to the row's other zones. */
  widthWeight: number;
  isEditing: boolean;
}

const DashboardZone = memo(function DashboardZone({
  panelId,
  zoneId,
  widgets,
  widthWeight,
  isEditing,
  onAssignWidget,
  onRemoveWidget,
  onWidgetConfigChange,
  onResizeWidgets,
}: DashboardZoneProps) {
  const assignToZone = useCallback(
    (type: string) => {
      onAssignWidget(panelId, zoneId, type);
    },
    [onAssignWidget, panelId, zoneId]
  );
  const resizeZone = useCallback(
    (sizes: number[]) => {
      onResizeWidgets(panelId, zoneId, sizes);
    },
    [onResizeWidgets, panelId, zoneId]
  );

  const growStyle = { flexGrow: widthWeight, flexBasis: 0 };

  if (widgets.length === 0) {
    if (!isEditing) {
      return <div style={growStyle} data-testid={`canvas-zone-${zoneId}`} />;
    }

    return (
      <div
        className="rounded-lg border-2 border-dashed border-border flex items-center justify-center"
        style={growStyle}
        data-testid={`canvas-zone-${zoneId}`}
      >
        <AddWidgetMenu
          onSelect={assignToZone}
          trigger={
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              data-testid={`button-add-widget-${zoneId}`}
            >
              <Plus className="h-4 w-4" />
              Add Widget
            </button>
          }
        />
      </div>
    );
  }

  const panelChildren: ReactNode[] = [];
  widgets.forEach((widget, index) => {
    const slotId = widgetSlotId(widget);
    if (index > 0 && isEditing) {
      panelChildren.push(<ResizableHandle key={`handle-${slotId}`} withHandle />);
    }
    panelChildren.push(
      <ResizablePanel key={slotId} defaultSize={widget.size ?? 100 / widgets.length} minSize={10}>
        <WidgetSlot
          panelId={panelId}
          zoneId={zoneId}
          widget={widget}
          isEditing={isEditing}
          isFirst={index === 0}
          onRemoveWidget={onRemoveWidget}
          onWidgetConfigChange={onWidgetConfigChange}
        />
      </ResizablePanel>
    );
  });

  return (
    <div className="flex flex-col min-h-0 gap-2" style={growStyle} data-testid={`canvas-zone-${zoneId}`}>
      {/* The surface is the zone's, not each widget's. It sits on the panel
          group rather than the outer div so the edit-mode Add Widget button
          below stays off it. */}
      <ResizablePanelGroup
        direction="vertical"
        className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-hidden"
        onLayout={isEditing ? resizeZone : undefined}
      >
        {panelChildren}
      </ResizablePanelGroup>
      {isEditing && (
        <AddWidgetMenu
          onSelect={assignToZone}
          trigger={
            <button
              type="button"
              className="shrink-0 flex items-center justify-center gap-1.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted border border-dashed border-border transition-colors"
              data-testid={`button-add-widget-${zoneId}`}
            >
              <Plus className="h-3 w-3" />
              Add Widget
            </button>
          }
        />
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
  onAssignWidget,
  onRemoveWidget,
  onWidgetConfigChange,
  onResizeWidgets,
}: DashboardCanvasProps) {
  const layout = getDashboardLayout(layoutId);

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

  if (!layout) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Unknown layout: {layoutId}
      </div>
    );
  }

  return (
    <div className="h-full p-4 flex flex-col gap-4">
      {layout.rows.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are a static, never-reordered layout definition
        <div key={`row-${rowIndex}`} className="flex gap-4 min-h-0" style={{ flexGrow: rowWeight(row), flexBasis: 0 }}>
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
                onAssignWidget={onAssignWidget}
                onRemoveWidget={onRemoveWidget}
                onWidgetConfigChange={onWidgetConfigChange}
                onResizeWidgets={onResizeWidgets}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
});
