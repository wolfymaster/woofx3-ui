import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import type { ActionStep } from "@woofx3/api";
import { useAction, useQuery } from "convex/react";
import { Loader2, Trash2 } from "lucide-react";
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
import {
  commandStepNumbers,
  compositionOfLibraryAlert,
  describeLinks,
  type LinkOwnerNames,
  linkOwnerKey,
  workflowStepNumbers,
} from "@/lib/alert-library";

export type LibraryAlert = Doc<"alertCompositions">;

interface AlertLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The library, undefined while it loads. */
  alerts: LibraryAlert[] | undefined;
  /** How many layers a copy replaces, so the dialog can say so. */
  replacesLayers: number;
  /** Link the step to the alert: it then plays the alert's latest published version. */
  onUse: (alert: LibraryAlert) => void;
  /** Copy the alert into the step, which then holds it as its own. */
  onDuplicate: (alert: LibraryAlert) => void;
}

/**
 * Start from…: the alerts stored in the engine's library. Use links the step to one,
 * so editing and publishing it changes every step that uses it; Duplicate copies it
 * into this step only. An alert can be deleted from here; the engine refuses while
 * steps still use it, and the dialog lists them.
 */
export function AlertLibraryDialog({
  open,
  onOpenChange,
  alerts,
  replacesLayers,
  onUse,
  onDuplicate,
}: AlertLibraryDialogProps) {
  const [deleting, setDeleting] = useState<LibraryAlert | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Start from a library alert</DialogTitle>
          <DialogDescription>
            Use plays the library alert from this step, and every change published to it shows here too. Duplicate
            copies it into this step only
            {replacesLayers > 0
              ? `, replacing the ${replacesLayers === 1 ? "layer" : `${replacesLayers} layers`} on this canvas (Cancel brings them back).`
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
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleting(alert)}
                      aria-label={`Delete ${alert.name} from the library`}
                      data-testid={`library-delete-${alert.engineCompositionId}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      onClick={() => onUse(alert)}
                      data-testid={`library-use-${alert.engineCompositionId}`}
                    >
                      Use
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDuplicate(alert)}
                      data-testid={`library-duplicate-${alert.engineCompositionId}`}
                    >
                      Duplicate
                    </Button>
                  </div>
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

/**
 * Confirms deleting a library alert, then says where it is still used when the engine
 * refuses: the engine keeps an alert while any step links it.
 */
function DeleteLibraryAlertDialog({ alert, onClose }: { alert: LibraryAlert | null; onClose: () => void }) {
  const { instance } = useInstance();
  const { toast } = useToast();
  const remove = useAction(api.alertCompositionActions.remove);
  const [pending, setPending] = useState(false);
  const [usedBy, setUsedBy] = useState<string[] | null>(null);
  const names = useLinkOwnerNames(alert !== null);

  const close = () => {
    setUsedBy(null);
    onClose();
  };

  const confirm = async () => {
    if (!alert || !instance) {
      return;
    }
    setPending(true);
    try {
      const result = await remove({ instanceId: instance._id, engineCompositionId: alert.engineCompositionId });
      if (result.success) {
        toast({ title: `Deleted ${alert.name}` });
        close();
        return;
      }
      if (result.links.length > 0) {
        setUsedBy(describeLinks(result.links, names));
        return;
      }
      toast({ title: "The alert wasn't deleted", description: "The engine refused.", variant: "destructive" });
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
    <AlertDialog open={alert !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <AlertDialogContent>
        {usedBy === null ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {alert?.name} from the library?</AlertDialogTitle>
              <AlertDialogDescription>
                It can't be brought back. The engine keeps it while any step still uses it.
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
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{alert?.name} is still in use</AlertDialogTitle>
              <AlertDialogDescription>
                These steps play it. Point them at another alert, or duplicate it into them, then delete it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="list-library-alert-links">
              {usedBy.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogAction onClick={close}>OK</AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** What the dashboard calls the workflows and commands a link can name, read while `active`. */
export function useLinkOwnerNames(active: boolean): LinkOwnerNames {
  const { instance } = useInstance();
  const workflows = useQuery(api.workflows.list, active && instance ? { instanceId: instance._id } : "skip");
  const commands = useQuery(api.chatCommands.list, active && instance ? { instanceId: instance._id } : "skip");
  return useMemo(
    () => ({
      workflows: new Map(
        (workflows ?? []).map((row) => [row.engineWorkflowId, workflowName(row.definition) ?? "A trigger"])
      ),
      commands: new Map((commands ?? []).map((row) => [row.engineCommandId, row.command])),
      stepNumbers: new Map([
        ...(workflows ?? []).map((row): [string, Map<string, number>] => [
          linkOwnerKey("workflow", row.engineWorkflowId),
          workflowStepNumbers(row),
        ]),
        ...(commands ?? []).map((row): [string, Map<string, number>] => [
          linkOwnerKey("command", row.engineCommandId),
          commandStepNumbers(row.actions as ActionStep[]),
        ]),
      ]),
    }),
    [workflows, commands]
  );
}

function workflowName(definition: unknown): string | undefined {
  if (typeof definition !== "object" || definition === null) {
    return undefined;
  }
  const name = (definition as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : undefined;
}
