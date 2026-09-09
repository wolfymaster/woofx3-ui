import type { Doc } from "@convex/_generated/dataModel";
import { LayoutTemplate, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
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
import { dashboardWidgetsByCategory, getDashboardWidget } from "@/lib/dashboard-widgets/registry";
import { widgetSlotId } from "@/lib/dashboard-widgets/types";

type DashboardPanel = NonNullable<Doc<"dashboardLayouts">["panels"]>[number];
type DashboardPanelWidget = DashboardPanel["widgets"][number];

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
  widget: DashboardPanelWidget;
  isEditing: boolean;
  onRemove: () => void;
  onConfigChange: (config: Record<string, unknown>) => void;
}

function WidgetSlot({ widget, isEditing, onRemove, onConfigChange }: WidgetSlotProps) {
  const entry = getDashboardWidget(widget.type);
  if (!entry) {
    return (
      <Card className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Unknown widget type: {widget.type}
      </Card>
    );
  }

  const Component = entry.component;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      {isEditing && (
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-muted/30 shrink-0">
          <span className="text-xs font-medium text-muted-foreground">{entry.label}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            data-testid={`button-remove-widget-${widgetSlotId(widget)}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Component config={widget.config} onConfigChange={onConfigChange} />
      </div>
    </Card>
  );
}

interface DashboardZoneProps {
  zoneId: string;
  widgets: DashboardPanelWidget[];
  /** Share of the row's width, relative to the row's other zones. */
  widthWeight: number;
  isEditing: boolean;
  onAssignWidget: (zoneId: string, type: string) => void;
  onRemoveWidget: (zoneId: string, slotId: string) => void;
  onWidgetConfigChange: (zoneId: string, slotId: string, type: string, config: Record<string, unknown>) => void;
  onResizeWidgets: (zoneId: string, sizes: number[]) => void;
}

function DashboardZone({
  zoneId,
  widgets,
  widthWeight,
  isEditing,
  onAssignWidget,
  onRemoveWidget,
  onWidgetConfigChange,
  onResizeWidgets,
}: DashboardZoneProps) {
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
          onSelect={(type) => onAssignWidget(zoneId, type)}
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
          widget={widget}
          isEditing={isEditing}
          onRemove={() => onRemoveWidget(zoneId, slotId)}
          onConfigChange={(config) => onWidgetConfigChange(zoneId, slotId, widget.type, config)}
        />
      </ResizablePanel>
    );
  });

  return (
    <div className="flex flex-col min-h-0 gap-2" style={growStyle} data-testid={`canvas-zone-${zoneId}`}>
      <ResizablePanelGroup
        direction="vertical"
        className="flex-1 min-h-0"
        onLayout={isEditing ? (sizes) => onResizeWidgets(zoneId, sizes) : undefined}
      >
        {panelChildren}
      </ResizablePanelGroup>
      {isEditing && (
        <AddWidgetMenu
          onSelect={(type) => onAssignWidget(zoneId, type)}
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
}

interface DashboardCanvasProps {
  panel: DashboardPanel;
  isEditing: boolean;
  onAssignWidget: (zoneId: string, type: string) => void;
  onRemoveWidget: (zoneId: string, slotId: string) => void;
  onWidgetConfigChange: (zoneId: string, slotId: string, type: string, config: Record<string, unknown>) => void;
  onResizeWidgets: (zoneId: string, sizes: number[]) => void;
}

export function DashboardCanvas({
  panel,
  isEditing,
  onAssignWidget,
  onRemoveWidget,
  onWidgetConfigChange,
  onResizeWidgets,
}: DashboardCanvasProps) {
  const layout = getDashboardLayout(panel.layoutId);

  const widgetsByZone = new Map<string, DashboardPanelWidget[]>();
  for (const widget of panel.widgets) {
    const zoneWidgets = widgetsByZone.get(widget.zoneId);
    if (zoneWidgets) {
      zoneWidgets.push(widget);
    } else {
      widgetsByZone.set(widget.zoneId, [widget]);
    }
  }

  if (!layout) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Unknown layout: {panel.layoutId}
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
                zoneId={zoneId}
                widthWeight={columnWeight(row, columnIndex)}
                widgets={widgetsByZone.get(zoneId) ?? []}
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
}
