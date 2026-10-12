import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { compositionOfLibraryAlert } from "@/lib/alert-library";

export type LibraryAlert = Doc<"alertCompositions">;

interface AlertLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The library, undefined while it loads. */
  alerts: LibraryAlert[] | undefined;
  /** How many layers a copy replaces, so the dialog can say so. */
  replacesLayers: number;
  /** Copy the alert into the step, which then holds it as its own. */
  onUse: (alert: LibraryAlert) => void;
  /** Open the library alert's own editor. */
  onEdit: (alert: LibraryAlert) => void;
}

/**
 * Start from…: the alerts stored in the engine's library. Using one copies it into this
 * step, which keeps the copy: the library alert stays a starting point, and editing it
 * later changes only the copies made after. Each alert can be edited on its own page or
 * deleted from here.
 */
export function AlertLibraryDialog({
  open,
  onOpenChange,
  alerts,
  replacesLayers,
  onUse,
  onEdit,
}: AlertLibraryDialogProps) {
  const [deleting, setDeleting] = useState<LibraryAlert | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Start from a library alert</DialogTitle>
          <DialogDescription>
            The alert is copied into this step, which keeps the copy
            {replacesLayers > 0
              ? `. It replaces the ${replacesLayers === 1 ? "layer" : `${replacesLayers} layers`} on this canvas (Cancel brings them back).`
              : "."}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          {alerts === undefined ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The library is empty. Save to library, in any alert's editor, puts an alert here.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {alerts.map((alert) => (
                <li key={alert._id} className="flex flex-col gap-2 rounded-[10px] border p-2">
                  <LibraryAlertPreview alert={alert} />
                  <div className="flex min-w-0 items-center gap-1 px-1">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{alert.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      onClick={() => onEdit(alert)}
                      aria-label={`Edit ${alert.name} in the library`}
                      data-testid={`library-edit-${alert.engineCompositionId}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleting(alert)}
                      aria-label={`Delete ${alert.name} from the library`}
                      data-testid={`library-delete-${alert.engineCompositionId}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onUse(alert)}
                    data-testid={`library-use-${alert.engineCompositionId}`}
                  >
                    Use as starting point
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
      <DeleteLibraryAlertDialog alert={deleting} onClose={() => setDeleting(null)} />
    </Dialog>
  );
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
