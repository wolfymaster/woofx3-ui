import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { HelpCircle, Plus, X } from "lucide-react";
import { type ComponentType, type ReactNode, useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type DashboardRailWidget, MAX_RAIL_WIDGETS } from "@/lib/dashboard-rail";
import { getDashboardWidget } from "@/lib/dashboard-widgets/registry";
import { cn } from "@/lib/utils";

/**
 * A rail entry the dashboard supplies itself rather than the user placing it:
 * always first, never moved or removed in edit mode, and gone when the
 * dashboard stops passing it.
 */
export interface RailPinnedItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Draws a dot on the icon: "attention" for something to do, "problem" for something wrong. */
  dot: "attention" | "problem" | null;
  content: ReactNode;
}

interface WidgetRailProps {
  pinned: RailPinnedItem | null;
  /** The saved rail, or its edit-mode draft. */
  widgets: DashboardRailWidget[];
  isEditing: boolean;
  /** Asks for a widget to dock; the dashboard owns the picker. */
  onAddWidget: () => void;
  onRemoveWidget: (slotId: string) => void;
  onMoveWidget: (slotId: string, toIndex: number) => void;
  onWidgetConfigChange: (slotId: string, config: Record<string, unknown>) => void;
}

function RailButton({
  widget,
  isOpen,
  isEditing,
  onToggle,
  onRemove,
}: {
  widget: DashboardRailWidget;
  isOpen: boolean;
  isEditing: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.slotId,
    disabled: !isEditing,
  });
  const entry = getDashboardWidget(widget.type);
  const Icon = entry?.icon ?? HelpCircle;
  const label = entry?.label ?? `Unknown widget: ${widget.type}`;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-60")}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            {...(isEditing ? { ...attributes, ...listeners } : {})}
            type="button"
            aria-label={label}
            aria-pressed={isOpen}
            className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center transition-colors",
              isEditing && "cursor-grab touch-none ring-1 ring-inset ring-primary/30 active:cursor-grabbing",
              isOpen ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            onClick={onToggle}
            data-testid={`button-rail-${widget.slotId}`}
          >
            <Icon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{isEditing ? `${label} · drag to reorder` : label}</TooltipContent>
      </Tooltip>
      {isEditing && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onRemove}
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-destructive"
          aria-label={`Remove ${label} from the rail`}
          data-testid={`button-remove-rail-${widget.slotId}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Right-edge dock of icon buttons, one per rail widget, each opening a
 * floating "peek" flyout over a dimming scrim. Only one flyout is open at a
 * time; the icon, the flyout's ✕, the scrim, and Escape all close it. Rail
 * widgets are ordinary registry entries, so any widget that can go on a panel
 * can be docked here instead.
 *
 * The rail is a column of the dashboard page rather than a `position: fixed`
 * overlay: fixed would sit on top of the app shell's sidebar and header.
 */
function PinnedRailButton({ item, isOpen, onToggle }: { item: RailPinnedItem; isOpen: boolean; onToggle: () => void }) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={item.dot ? `${item.label} (things to do)` : item.label}
          aria-pressed={isOpen}
          className={cn(
            "relative h-9 w-9 rounded-lg flex items-center justify-center transition-colors",
            isOpen ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          onClick={onToggle}
          data-testid={`button-rail-${item.id}`}
        >
          <Icon className="h-4 w-4" />
          {item.dot && (
            <span
              className={cn(
                "absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-background",
                item.dot === "problem" ? "bg-destructive" : "bg-primary"
              )}
              data-testid={`dot-rail-${item.id}`}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{item.label}</TooltipContent>
    </Tooltip>
  );
}

export function WidgetRail({
  pinned,
  widgets,
  isEditing,
  onAddWidget,
  onRemoveWidget,
  onMoveWidget,
  onWidgetConfigChange,
}: WidgetRailProps) {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!openSlotId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenSlotId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSlotId]);

  const openPinned = pinned && pinned.id === openSlotId ? pinned : null;
  const openWidget = widgets.find((widget) => widget.slotId === openSlotId);
  const openEntry = openWidget ? getDashboardWidget(openWidget.type) : undefined;
  const OpenComponent = openEntry?.component;

  const handleOpenConfigChange = useCallback(
    (config: Record<string, unknown>) => {
      if (openSlotId) {
        onWidgetConfigChange(openSlotId, config);
      }
    },
    [openSlotId, onWidgetConfigChange]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return;
    }
    const toIndex = widgets.findIndex((widget) => widget.slotId === event.over?.id);
    if (toIndex !== -1) {
      onMoveWidget(String(event.active.id), toIndex);
    }
  };

  return (
    <>
      <div
        className="shrink-0 w-[52px] h-full flex flex-col items-center gap-1 py-4 border-l border-border"
        data-testid="dashboard-widget-rail"
      >
        {pinned && (
          <>
            <PinnedRailButton
              item={pinned}
              isOpen={openSlotId === pinned.id}
              onToggle={() => setOpenSlotId((prev) => (prev === pinned.id ? null : pinned.id))}
            />
            {widgets.length > 0 && <div className="my-1 h-px w-6 bg-border" />}
          </>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={widgets.map((widget) => widget.slotId)} strategy={verticalListSortingStrategy}>
            {widgets.map((widget) => (
              <RailButton
                key={widget.slotId}
                widget={widget}
                isOpen={openSlotId === widget.slotId}
                isEditing={isEditing}
                onToggle={() => setOpenSlotId((prev) => (prev === widget.slotId ? null : widget.slotId))}
                onRemove={() => {
                  if (openSlotId === widget.slotId) {
                    setOpenSlotId(null);
                  }
                  onRemoveWidget(widget.slotId);
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
        {isEditing && widgets.length < MAX_RAIL_WIDGETS && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Add a widget to the rail"
                className="mt-1 h-9 w-9 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={onAddWidget}
                data-testid="button-add-rail-widget"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Add a widget to the rail</TooltipContent>
          </Tooltip>
        )}
      </div>

      {(openPinned || openWidget) && (
        <>
          {/* Scrim: dims the canvas and closes the flyout on click. */}
          <button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setOpenSlotId(null)}
            data-testid="scrim-widget-rail"
          />
          <Card
            className="fixed right-[64px] top-24 bottom-8 z-50 w-[340px] flex flex-col overflow-hidden shadow-2xl ring-1 ring-primary/15"
            data-testid={`flyout-rail-${openPinned?.id ?? openWidget?.type}`}
          >
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold">{openPinned?.label ?? openEntry?.label ?? openWidget?.type}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setOpenSlotId(null)}
                aria-label="Close"
                data-testid="button-close-rail-flyout"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {openPinned ? (
                openPinned.content
              ) : OpenComponent ? (
                <OpenComponent config={openWidget?.config} onConfigChange={handleOpenConfigChange} />
              ) : (
                <div className="h-full flex items-center justify-center p-3 text-center text-sm text-muted-foreground">
                  Unknown widget type: {openWidget?.type}
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
