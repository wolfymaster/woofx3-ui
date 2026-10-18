import type { UnreadReport } from "@woofx3/api/scene-editor/protocol";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { endedUnreadable, unreadColumnsText, unreadPlacementCount } from "@/lib/scene-unread";

interface UnreadSceneNoticeProps {
  /** The session's state: whether it ended, and what the engine could not read. */
  conn: string | null;
  unread: UnreadReport | null | undefined;
  /** What is being edited, "scene" or "alert". */
  noun: string;
  /** Whether the engine can repair (capability `scenes.repair`). */
  repairSupported: boolean;
  /** Ask the engine to repair; resolves once it has answered, however it answered. */
  onRepair: () => Promise<void>;
}

/**
 * Stored data the engine could not read, and the way out. A column it could
 * not read stops all editing; placements it could not read are only left out
 * of what is shown. Repairing sets either aside on the engine, keeping a copy,
 * because data a newer engine wrote can look unreadable to an older one.
 */
export function UnreadSceneNotice({ conn, unread, noun, repairSupported, onRepair }: UnreadSceneNoticeProps) {
  const [confirming, setConfirming] = useState(false);
  const [repairing, setRepairing] = useState(false);
  if (unread == null) {
    return null;
  }
  const blocked = endedUnreadable(conn, unread);
  const placements = unreadPlacementCount(unread);
  if (!blocked && placements === 0) {
    return null;
  }

  const title = blocked
    ? `This engine can't read part of this ${noun}`
    : `${placements} ${placements === 1 ? "layer" : "layers"} in this ${noun} can't be read`;
  const explanation = blocked
    ? `It can't read ${unreadColumnsText(unread)}, so the ${noun} can't be edited. This can happen after moving to an older engine version.`
    : `They're kept as they were stored, but aren't shown or played. This can happen after moving to an older engine version.`;
  const repairLabel = blocked ? `Repair ${noun}` : `Set ${placements === 1 ? "it" : "them"} aside`;

  const repair = async () => {
    setConfirming(false);
    setRepairing(true);
    try {
      await onRepair();
    } finally {
      setRepairing(false);
    }
  };

  return (
    <>
      <Alert
        variant={blocked ? "destructive" : "default"}
        className="shrink-0 rounded-none border-x-0 border-t-0"
        data-testid="notice-unread-scene"
      >
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{explanation}</p>
          {repairSupported ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={repairing}
              data-testid="button-repair-scene"
            >
              {repairing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {repairing ? "Repairing…" : repairLabel}
            </Button>
          ) : (
            <p>Update your engine to repair it from here.</p>
          )}
        </AlertDescription>
      </Alert>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Repair this {noun}?</AlertDialogTitle>
            <AlertDialogDescription>
              {blocked
                ? `What can't be read is removed from the ${noun}, leaving it empty where it was, and everything else stays.`
                : `The layers that can't be read are removed from the ${noun}; every other layer stays.`}{" "}
              The engine keeps an exact copy of what it removes, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void repair()} data-testid="button-confirm-repair-scene">
              Repair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
