import { Loader2 } from "lucide-react";
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

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The release the engine moves to. */
  offered: string;
  /** The release it runs now, when known. */
  current: string | null;
  busy: boolean;
  onConfirm: () => void;
}

/** Confirms an upgrade: it takes the engine and its overlays offline, so it is never one click. */
export function UpgradeDialog({ open, onOpenChange, offered, current, busy, onConfirm }: UpgradeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Upgrade to {offered}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your engine and its overlays will be offline for a few minutes while {offered} starts. If {offered} doesn't
            start, we'll restore {current ?? "the release you have now"} automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Kept open until the request resolves, so the pending state is visible.
              event.preventDefault();
              onConfirm();
            }}
            disabled={busy}
            data-testid="button-confirm-upgrade-engine"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Upgrade
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
