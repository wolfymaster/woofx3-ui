import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { ListX, Loader2, SkipForward } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { type AlertQueueSnapshot, clearConfirmLabel, clearResultToast, skipResultToast } from "@/lib/alert-queue";
import { cn } from "@/lib/utils";

interface AlertQueueControlsProps {
  instanceId: Id<"instances">;
  /** What the alert log shows of the queue; worded into the buttons, never used to disable them. */
  snapshot: AlertQueueSnapshot;
  className?: string;
}

type Pending = "skip" | "clear" | null;

/**
 * Skip the playing alert, or drop everything still waiting.
 *
 * Neither control is gated on the log: the log is a recent window that lags
 * the engine, and a raid train is exactly when the two disagree. Clearing asks
 * first, inline, because it throws away alerts a viewer paid for.
 */
export function AlertQueueControls({ instanceId, snapshot, className }: AlertQueueControlsProps) {
  const skipCurrent = useAction(api.alertActions.skipCurrent);
  const clearQueue = useAction(api.alertActions.clearQueue);
  const { toast } = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const busy = pending !== null;

  const run = async (kind: Exclude<Pending, null>) => {
    setPending(kind);
    try {
      if (kind === "skip") {
        toast(skipResultToast(await skipCurrent({ instanceId })));
      } else {
        toast(clearResultToast(await clearQueue({ instanceId })));
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: kind === "skip" ? "Could not skip the alert" : "Could not clear the queue",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPending(null);
      setConfirmingClear(false);
    }
  };

  if (confirmingClear) {
    return (
      <fieldset
        aria-label="Confirm clearing the alert queue"
        className={cn("m-0 flex items-center gap-1.5 border-0 p-0", className)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            setConfirmingClear(false);
          }
        }}
        data-testid="alert-queue-confirm-clear"
      >
        <span className="text-xs text-muted-foreground">{clearConfirmLabel(snapshot.waiting)}</span>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={() => void run("clear")}
          autoFocus
          data-testid="button-alert-queue-confirm-clear"
        >
          {pending === "clear" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Drop
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={() => setConfirmingClear(false)}
          data-testid="button-alert-queue-cancel-clear"
        >
          Cancel
        </Button>
      </fieldset>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)} data-testid="alert-queue-controls">
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy}
        onClick={() => void run("skip")}
        title={snapshot.playing ? "Stop the alert playing now" : "Stop the alert playing now, if any"}
        data-testid="button-alert-queue-skip"
      >
        {pending === "skip" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <SkipForward className="h-3.5 w-3.5" />
        )}
        Skip
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy}
        onClick={() => setConfirmingClear(true)}
        title="Drop every alert still waiting to play"
        data-testid="button-alert-queue-clear"
      >
        <ListX className="h-3.5 w-3.5" />
        {snapshot.waiting > 0 ? `Clear queue (${snapshot.waiting})` : "Clear queue"}
      </Button>
    </div>
  );
}
