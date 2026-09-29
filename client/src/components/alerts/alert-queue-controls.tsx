import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { ListX, Loader2, SkipForward } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { useToast } from "@/hooks/use-toast";
import { clearResultToast, skipResultToast } from "@/lib/alert-queue";
import { ALERT_QUEUE_CONTROL_CAPABILITIES, capabilitySupport } from "@/lib/engine-capabilities";
import { cn } from "@/lib/utils";

interface AlertQueueControlsProps {
  instanceId: Id<"instances">;
  className?: string;
}

type Pending = "skip" | "clear" | null;

/**
 * Skip the playing alert, or drop everything still waiting.
 *
 * Neither control is gated on the alert log, which cannot tell a waiting alert
 * from a playing one (see lib/alert-queue.ts). Clearing asks first, inline,
 * because it throws away alerts a viewer paid for.
 */
export function AlertQueueControls({ instanceId, className }: AlertQueueControlsProps) {
  const skipCurrent = useAction(api.alertActions.skipCurrent);
  const clearQueue = useAction(api.alertActions.clearQueue);
  const { toast } = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const { state: capabilities } = useEngineCapabilities(instanceId);
  const support = capabilitySupport(capabilities, ALERT_QUEUE_CONTROL_CAPABILITIES);
  const busy = pending !== null;
  const unavailable = support !== "supported";
  const unavailableTitle =
    support === "unsupported" ? "Needs engine update" : support === "unknown" ? "Couldn't check the engine" : undefined;

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
      if (kind === "clear") {
        setConfirmingClear(false);
      }
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
        <span className="text-xs text-muted-foreground">Drop every alert still waiting?</span>
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
        disabled={busy || unavailable}
        onClick={() => void run("skip")}
        title={unavailableTitle ?? "Stop the alert playing now"}
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
        disabled={busy || unavailable}
        onClick={() => setConfirmingClear(true)}
        title={unavailableTitle ?? "Drop every alert still waiting to play"}
        data-testid="button-alert-queue-clear"
      >
        <ListX className="h-3.5 w-3.5" />
        Clear queue
      </Button>
      {support === "unsupported" && (
        <span className="text-xs text-muted-foreground" data-testid="text-alert-queue-needs-update">
          Needs engine update
        </span>
      )}
    </div>
  );
}
