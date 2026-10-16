import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Lock, LockOpen, Trash2 } from "lucide-react";
import { widgetIconFor } from "@/components/overlay-editor/widget-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What the list reads of a layer; each editor hands it its own layer type. */
export interface Layer {
  id: string;
  /** False for a hidden layer; see `onToggleVisible`. */
  visible: boolean;
  /** True for a layer that cannot be moved or resized on the canvas; see `onToggleLock`. */
  locked?: boolean;
}

interface LayersListProps<T extends Layer> {
  /** Topmost first; this does not sort. */
  layers: readonly T[];
  selectedId: string | null;
  /** The label a layer goes by, shared with the canvas so both name it the same. */
  label: (layer: T) => string;
  /** The layer's widget's taxonomy, looked up from the editor's catalog, for the icon. */
  taxonomyOf: (layer: T) => string[] | undefined;
  /** Trailing note, e.g. an alert layer's length. Omitted where a layer has no such axis. */
  meta?: (layer: T) => string;
  onSelect: (widgetId: string) => void;
  /** A layer dragged to `toIndex` of `layers`, topmost first. */
  onMove: (widgetId: string, toIndex: number) => void;
  /** Gives each layer a delete button. */
  onDelete?: (widgetId: string) => void;
  /** Gives each layer a show/hide button; a hidden layer is struck through. */
  onToggleVisible?: (widgetId: string) => void;
  /** Gives each layer a lock/unlock button; a locked layer's button stays shown. */
  onToggleLock?: (widgetId: string) => void;
  /** The phone layout lays the layers out as one sideways-scrolling row. */
  horizontal?: boolean;
  emptyMessage: string;
}

function LayerRow({
  layer,
  label,
  note,
  icon: Icon,
  isSelected,
  horizontal,
  canDrag,
  onSelect,
  onDelete,
  onToggleVisible,
  onToggleLock,
}: {
  layer: Layer;
  label: string;
  note: string | undefined;
  icon: ReturnType<typeof widgetIconFor>;
  isSelected: boolean;
  horizontal: boolean;
  canDrag: boolean;
  onSelect: (widgetId: string) => void;
  onDelete: ((widgetId: string) => void) | undefined;
  onToggleVisible: ((widgetId: string) => void) | undefined;
  onToggleLock: ((widgetId: string) => void) | undefined;
}) {
  const hidden = onToggleVisible !== undefined && layer.visible === false;
  const locked = layer.locked === true;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
    disabled: !canDrag,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group flex shrink-0 items-center text-sm hover:bg-accent",
        horizontal ? "h-11 max-w-[220px] rounded-full border pl-1 pr-3" : "min-h-9 rounded-lg pr-2",
        isSelected && "bg-accent ring-2 ring-inset ring-primary",
        isDragging && "relative z-10 bg-card opacity-80 shadow-md"
      )}
      data-testid={`layer-${layer.id}`}
    >
      {canDrag && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          aria-label={`Move ${label} up or down the stack`}
          data-testid={`layer-handle-${layer.id}`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onSelect(layer.id)}
        className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left", !canDrag && "pl-2")}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={cn("min-w-0 flex-1 truncate", hidden && "text-muted-foreground line-through")}>{label}</span>
        {note ? <span className="shrink-0 font-mono text-xs text-muted-foreground">{note}</span> : null}
      </button>
      {onToggleLock && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "shrink-0 text-muted-foreground",
            horizontal ? "h-11 w-11 rounded-full" : "h-7 w-7",
            // An unlocked layer's button shows on hover, so a locked one stands out in the list.
            !locked && !horizontal && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          )}
          onClick={() => onToggleLock(layer.id)}
          aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
          aria-pressed={locked}
          data-testid={`button-lock-layer-${layer.id}`}
        >
          {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        </Button>
      )}
      {onToggleVisible && (
        <Button
          variant="ghost"
          size="icon"
          className={cn("shrink-0 text-muted-foreground", horizontal ? "h-11 w-11 rounded-full" : "h-7 w-7")}
          onClick={() => onToggleVisible(layer.id)}
          aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
          aria-pressed={hidden}
          data-testid={`button-visibility-layer-${layer.id}`}
        >
          {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "shrink-0 text-muted-foreground hover:text-destructive",
            horizontal ? "-mr-3 h-11 w-11 rounded-full" : "h-7 w-7"
          )}
          onClick={() => onDelete(layer.id)}
          aria-label={`Delete ${label}`}
          data-testid={`button-delete-layer-${layer.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * The layers on the canvas, topmost first; picking one selects it on the
 * canvas, and dragging one by its grip moves it up or down the stack. Arrow
 * keys move a focused grip too.
 *
 * Shared by both editors. `meta` is the one axis they differ on — an alert
 * layer has a length, a scene widget does not — so it is a slot rather than a
 * flag, and a scene simply passes none.
 */
export function LayersList<T extends Layer>({
  layers,
  selectedId,
  label,
  taxonomyOf,
  meta,
  onSelect,
  onMove,
  onDelete,
  onToggleVisible,
  onToggleLock,
  horizontal = false,
  emptyMessage,
}: LayersListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const canDrag = layers.length > 1;

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return;
    }
    const toIndex = layers.findIndex((layer) => layer.id === event.over?.id);
    if (toIndex !== -1) {
      onMove(String(event.active.id), toIndex);
    }
  };

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Layers</h2>
        {canDrag && !horizontal && <span className="text-[11px] text-muted-foreground">Top of the stack first</span>}
      </div>
      {layers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={layers.map((layer) => layer.id)}
            strategy={horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy}
          >
            <div className={cn(horizontal ? "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" : "flex flex-col gap-1")}>
              {layers.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  label={label(layer)}
                  note={meta?.(layer)}
                  icon={widgetIconFor(taxonomyOf(layer))}
                  isSelected={layer.id === selectedId}
                  horizontal={horizontal}
                  canDrag={canDrag}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onToggleVisible={onToggleVisible}
                  onToggleLock={onToggleLock}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}
