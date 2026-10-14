import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { replayResultToast } from "@/lib/alert-queue";

/** Plays one recorded alert again, reporting the engine's answer as a toast. */
export function useReplayAlert(instanceId: Id<"instances">): {
  replay: (engineAlertId: string) => Promise<void>;
  busy: boolean;
} {
  const replayAction = useAction(api.alertActions.replay);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const replay = async (engineAlertId: string) => {
    setBusy(true);
    try {
      // The new dispatch and the original's `replayed` status both arrive as
      // webhooks, so every list updates itself; the toast only reports what
      // the engine answered.
      toast(replayResultToast(await replayAction({ instanceId, engineAlertId })));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Replay could not be started",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return { replay, busy };
}
