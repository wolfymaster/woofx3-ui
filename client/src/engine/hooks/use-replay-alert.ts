import { useState } from "react";
import { useEngineGateway } from "@/engine/context";
import type { InstanceId } from "@/engine/types";
import { useToast } from "@/hooks/use-toast";
import { replayResultToast } from "@/lib/alert-queue";

/** Plays one recorded alert again, reporting the engine's answer as a toast. */
export function useReplayAlert(instanceId: InstanceId): {
  replay: (engineAlertId: string) => Promise<void>;
  busy: boolean;
} {
  const replayAction = useEngineGateway().alertQueue.useReplayRequest();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const replay = async (engineAlertId: string) => {
    setBusy(true);
    try {
      // The new dispatch and the original's `replayed` status both arrive as
      // webhooks, so every list updates itself; the toast only reports what
      // the engine answered.
      toast(replayResultToast(await replayAction(instanceId, engineAlertId)));
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
