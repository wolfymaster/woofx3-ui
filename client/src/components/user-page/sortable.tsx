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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A vertical list reordered by dragging each item's grip, or by arrow keys on
 * a focused grip, as the layers list does. Reports a drop as the dragged id
 * and the id it landed on; the caller moves it.
 */
export function SortableList({
  ids,
  onMove,
  children,
  className,
}: {
  ids: readonly string[];
  onMove: (id: string, overId: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return;
    }
    onMove(String(event.active.id), String(event.over.id));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

/** One item of a SortableList. `children` receives the grip to place where the item's handle belongs. */
export function SortableItem({
  id,
  label,
  canDrag,
  className,
  children,
}: {
  id: string;
  /** What the grip moves, for its accessible name. */
  label: string;
  canDrag: boolean;
  className?: string;
  children: (grip: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canDrag,
  });
  const grip = canDrag ? (
    <button
      type="button"
      {...attributes}
      {...listeners}
      className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      aria-label={`Move ${label}`}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  ) : null;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(className, isDragging && "relative z-10 opacity-80 shadow-lg")}
    >
      {children(grip)}
    </div>
  );
}
