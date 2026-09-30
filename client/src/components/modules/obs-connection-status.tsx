import type { Id } from "@convex/_generated/dataModel";
import { AlertCircle, CheckCircle2, CircleHelp, Loader2 } from "lucide-react";
import { useObsStatus } from "@/hooks/use-obs-status";
import { describeObsStatus, type ObsStatusTone } from "@/lib/obs-status";
import { cn } from "@/lib/utils";

function ToneIcon({ tone }: { tone: ObsStatusTone }) {
  if (tone === "ok") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />;
  }
  if (tone === "problem") {
    return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />;
  }
  if (tone === "pending") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />;
  }
  return <CircleHelp className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

/**
 * Whether the engine is connected to OBS, above the OBS module's settings, so
 * a wrong password or address shows as soon as it is saved. Renders nothing
 * on an engine that cannot report it.
 */
export function ObsConnectionStatus({ instanceId }: { instanceId: Id<"instances"> }) {
  const { support, status } = useObsStatus(instanceId, true);
  if (support !== "supported") {
    return null;
  }
  const description = status ? describeObsStatus(status) : { tone: "pending" as const, text: "Checking OBS…" };
  return (
    <output
      className={cn(
        "flex max-w-xl items-start gap-2 rounded-md border px-3 py-2 text-sm",
        description.tone === "problem" && "border-destructive/30 bg-destructive/5",
        description.tone === "ok" && "border-green-500/30 bg-green-500/5"
      )}
      data-testid="obs-connection-status"
    >
      <ToneIcon tone={description.tone} />
      <span>{description.text}</span>
    </output>
  );
}
