import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AlertLayoutPreview } from "@/components/alerts/alert-layout-preview";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { compositionOfLibraryAlert } from "@/lib/alert-library";
import { cn } from "@/lib/utils";

export type LibraryAlert = Doc<"alertCompositions">;

interface LibraryAlertListProps {
  /** The library, undefined while it loads. */
  alerts: LibraryAlert[] | undefined;
  /** `grid` for the editor's left rail, `row` for the phone strip that scrolls sideways. */
  layout: "grid" | "row";
  /** Add the alert's layers to the canvas; the caller confirms first. */
  onPick: (alert: LibraryAlert) => void;
  /** Open the library alert's own editor. */
  onEdit: (alert: LibraryAlert) => void;
}

/**
 * The alerts stored in the engine's library, as the editor's Library tab lists them.
 * Picking one adds copies of its layers to the canvas: the library alert stays a
 * starting point, and editing it later changes nothing already copied. Each alert can
 * also be edited on its own page or deleted from here.
 */
export function LibraryAlertList({ alerts, layout, onPick, onEdit }: LibraryAlertListProps) {
  const [deleting, setDeleting] = useState<LibraryAlert | null>(null);

  if (alerts === undefined) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (alerts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        The library is empty. Save to library, under Done in any alert's editor, puts an alert here.
      </p>
    );
  }

  return (
    <>
      <ul
        className={cn(layout === "grid" ? "flex flex-col gap-3" : "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1")}
        data-testid="library-alert-list"
      >
        {alerts.map((alert) => (
          <li
            key={alert._id}
            className={cn(
              "flex flex-col gap-1.5 rounded-xl border bg-muted/30 p-1.5 hover:border-foreground/20 hover:bg-accent",
              layout === "row" && "w-40 shrink-0"
            )}
          >
            <button
              type="button"
              className="text-left"
              onClick={() => onPick(alert)}
              title={`Add ${alert.name} to the canvas`}
              data-testid={`library-add-${alert.engineCompositionId}`}
            >
              <LibraryAlertPreview alert={alert} />
            </button>
            <DropdownMenu>
              <div className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium">{alert.name}</span>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground"
                    aria-label={`More options for ${alert.name}`}
                    data-testid={`library-menu-${alert.engineCompositionId}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => onEdit(alert)}
                  data-testid={`library-edit-${alert.engineCompositionId}`}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit in library
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleting(alert)}
                  data-testid={`library-delete-${alert.engineCompositionId}`}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      <DeleteLibraryAlertDialog alert={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/**
 * Asks before a library alert's layers are added to the canvas. They are copied, not
 * linked, which the prompt says so nobody expects later library edits to follow.
 */
export function AddLibraryAlertDialog({
  alert,
  onClose,
  onConfirm,
}: {
  alert: LibraryAlert | null;
  onClose: () => void;
  onConfirm: (alert: LibraryAlert) => void;
}) {
  const layers = alert === null ? 0 : compositionLayerCount(alert);
  return (
    <AlertDialog open={alert !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Add {alert?.name} to the canvas?</AlertDialogTitle>
          <AlertDialogDescription>
            {layers === 1 ? "Its widget is" : `All ${layers} of its widgets are`} copied onto this canvas, on top of
            what's already there. The copies aren't linked to the library: changing the library alert later doesn't
            change them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (alert !== null) {
                onConfirm(alert);
              }
            }}
            data-testid="button-confirm-library-add"
          >
            Add widgets
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function compositionLayerCount(alert: LibraryAlert): number {
  return Object.keys(compositionOfLibraryAlert(alert).widgets).length;
}

/** A still of a library alert's published version. */
export function LibraryAlertPreview({ alert, className }: { alert: LibraryAlert; className?: string }) {
  const doc = useMemo(() => compositionOfLibraryAlert(alert), [alert]);
  return <AlertLayoutPreview layout={doc} className={className} />;
}

/** Confirms deleting a library alert. Steps keep the copies they were given. */
function DeleteLibraryAlertDialog({ alert, onClose }: { alert: LibraryAlert | null; onClose: () => void }) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const remove = useAction(api.alertCompositionActions.remove);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!alert || !instance) {
      return;
    }
    setPending(true);
    try {
      const result = await remove({ instanceId: instance._id, engineCompositionId: alert.engineCompositionId });
      if (!result.success) {
        toast({ title: "The alert wasn't deleted", description: "The engine refused.", variant: "destructive" });
        return;
      }
      toast({ title: `Deleted ${alert.name}` });
      onClose();
    } catch (error) {
      toast({
        title: "The alert wasn't deleted",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={alert !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {alert?.name} from the library?</AlertDialogTitle>
          <AlertDialogDescription>
            It can't be brought back. Alerts already started from it keep their copies.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
            data-testid="button-confirm-library-delete"
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
