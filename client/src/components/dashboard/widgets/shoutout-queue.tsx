import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, GripVertical, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ShoutoutQueueEntry {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
  broadcasterType?: string;
  attempts: number;
  nextEligibleAt: number;
  lastError?: string;
}

/** Twitch sends "" for a channel that is neither. */
function broadcasterBadge(broadcasterType: string | undefined): string | null {
  if (broadcasterType === "partner") {
    return "Partner";
  }
  if (broadcasterType === "affiliate") {
    return "Affiliate";
  }
  return null;
}

/** "in 3m" / "shortly" — enough to explain why an entry is sitting there. */
function untilLabel(nextEligibleAt: number, now: number): string {
  const seconds = Math.round((nextEligibleAt - now) / 1000);
  if (seconds <= 30) {
    return "shortly";
  }
  if (seconds < 90) {
    return "in a minute";
  }
  return `in ${Math.round(seconds / 60)}m`;
}

interface RowProps {
  entry: ShoutoutQueueEntry;
  now: number;
  onRemove: () => void;
}

function QueueRow({ entry, now, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const badge = broadcasterBadge(entry.broadcasterType);
  const isRetrying = entry.attempts > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-card p-2",
        isDragging && "z-10 border-primary shadow-lg opacity-80"
      )}
      data-testid={`shoutout-entry-${entry.login}`}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing"
        aria-label={`Reorder ${entry.displayName}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={entry.profileImageUrl} alt="" />
        <AvatarFallback className="text-[10px]">{entry.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{entry.displayName}</span>
          {badge && (
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
              {badge}
            </Badge>
          )}
        </div>
        {isRetrying && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {/* Attempt count rather than the raw error: the common failure
                      is simply that they are not live yet, and the full Twitch
                      body is noise until you ask for it. */}
                  Retrying {untilLabel(entry.nextEligibleAt, now)} · attempt {entry.attempts + 1}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{entry.lastError ?? "The last attempt failed."}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label={`Remove ${entry.displayName} from the queue`}
        data-testid={`button-remove-shoutout-${entry.login}`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

interface ShoutoutQueueProps {
  entries: ShoutoutQueueEntry[];
  now: number;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

export function ShoutoutQueue({ entries, now, onRemove, onReorder }: ShoutoutQueueProps) {
  // A few pixels of movement before a drag starts, so clicking the remove
  // button next to the handle is not swallowed.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = entries.findIndex((e) => e.id === active.id);
    const to = entries.findIndex((e) => e.id === over.id);
    if (from === -1 || to === -1) {
      return;
    }
    onReorder(arrayMove(entries, from, to).map((e) => e.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {entries.map((entry) => (
            <QueueRow key={entry.id} entry={entry} now={now} onRemove={() => onRemove(entry.id)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
