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
  /** The release the engine moves to. */
  offered: string;
  /** The release it runs now, when known. */
  current: string | null;
  /** Whether the channel is live: viewers would see alerts stop, so it takes a second confirmation. */
  isLive: boolean;
  busy: boolean;
  onConfirm: () => void;
}

/**
 * Confirms an upgrade: it takes the engine and its overlays offline, so it is
 * never one click, and never two while the channel is live.
 */
export function UpgradeDialog({ open, onOpenChange, offered, current, isLive, busy, onConfirm }: UpgradeDialogProps) {
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
              Alerts will be offline until the engine is back online, usually a few minutes. Follows, subs, raids and
              other events during the upgrade won't show on stream, and chat commands won't respond.
            </AlertDialogDescription>
          </AlertDialogHeader>
        ) : (
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade to {offered}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your engine and its overlays will be offline for a few minutes while {offered} starts. If {offered}{" "}
              doesn't start, we'll restore {current ?? "the release you have now"} automatically.
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
            {onLiveStep ? "Upgrade while live" : isLive ? "Continue" : "Upgrade"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
