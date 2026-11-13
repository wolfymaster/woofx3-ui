import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useEngineStarting } from "@/hooks/use-engine-starting";

export function EngineStartingNotice({ phase }: { phase: string }) {
  return (
    <div
      className="flex items-center gap-3 border-b border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm shrink-0"
      data-testid="banner-engine-starting"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
      <p className="min-w-0 flex-1">
        Your engine is starting. Your dashboard will fill in as it comes up.{" "}
        <span className="text-muted-foreground">Now: {phase}.</span>
      </p>
      <Link href="/setup/finish" className="shrink-0 font-medium underline" data-testid="link-engine-progress">
        See progress
      </Link>
    </div>
  );
}

/** A strip under the shell header while the managed engine is still being built. */
export function EngineStartingBanner() {
  const starting = useEngineStarting();
  return starting ? <EngineStartingNotice phase={starting.phase} /> : null;
}
