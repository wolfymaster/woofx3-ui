import { Loader2, Radio } from "lucide-react";
import { useEffect, useState } from "react";
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
import { buttonVariants } from "@/components/ui/button";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the channel is live: viewers would see alerts stop, so it takes a second confirmation. */
  isLive: boolean;
  busy: boolean;
  onConfirm: () => void;
}

/**
 * Confirms an update: it takes woofx3 and its overlays offline, so it is
 * never one click, and never two while the channel is live.
 */
export function UpgradeDialog({ open, onOpenChange, isLive, busy, onConfirm }: UpgradeDialogProps) {
  const [liveWarningShown, setLiveWarningShown] = useState(false);

  useEffect(() => {
    if (!open) {
      setLiveWarningShown(false);
    }
  }, [open]);

  const onLiveStep = isLive && liveWarningShown;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {onLiveStep ? (
          <AlertDialogHeader>
            <AlertDialogTitle className="inline-flex items-center gap-2">
              <Radio className="h-5 w-5 text-destructive" />
              You're live right now
            </AlertDialogTitle>
            <AlertDialogDescription>
              Alerts will be offline until woofx3 is back online, usually a few minutes. Follows, subs, raids and other
              events during the update won't show on stream, and chat commands won't respond.
            </AlertDialogDescription>
          </AlertDialogHeader>
        ) : (
          <AlertDialogHeader>
            <AlertDialogTitle>Update woofx3?</AlertDialogTitle>
            <AlertDialogDescription>
              Your alerts and overlays will be offline for a few minutes. If the update fails we&apos;ll roll back
              automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={onLiveStep ? buttonVariants({ variant: "destructive" }) : undefined}
            onClick={(event) => {
              // Kept open until the request resolves, so the pending state is visible.
              event.preventDefault();
              if (isLive && !liveWarningShown) {
                setLiveWarningShown(true);
                return;
              }
              onConfirm();
            }}
            disabled={busy}
            data-testid={onLiveStep ? "button-confirm-upgrade-engine-live" : "button-confirm-upgrade-engine"}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {onLiveStep ? "Update while live" : isLive ? "Continue" : "Update"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
