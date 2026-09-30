import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SetupStatus } from "@convex/setup";
import { useMutation } from "convex/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { $currentInstanceId } from "@/lib/stores";

interface FinishStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
}

/**
 * Setup's last page. It records setup as finished, then waits for the engine:
 * the rest of the app needs a registered engine, so the dashboard opens by
 * itself as soon as there is one.
 */
export function FinishStep({ instanceId, status }: FinishStepProps) {
  const complete = useMutation(api.setup.complete);
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(false);

  useEffect(() => {
    if (status.completedAt !== null || requested.current) {
      return;
    }
    requested.current = true;
    complete({ instanceId }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [complete, instanceId, status.completedAt]);

  const ready = status.completedAt !== null && status.engineRegistered;

  useEffect(() => {
    if (!ready) {
      return;
    }
    $currentInstanceId.set(instanceId);
    navigate("/");
  }, [ready, instanceId, navigate]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        Your choices are saved.
      </p>
      <p className="flex items-center gap-2 text-muted-foreground" data-testid="text-waiting-for-engine">
        <Loader2 className="h-4 w-4 animate-spin" />
        {ready ? "Opening your dashboard…" : "Your dashboard opens as soon as your engine is ready."}
      </p>
    </div>
  );
}
