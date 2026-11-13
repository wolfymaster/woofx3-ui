import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { buildElapsedLabel, type EngineBuild } from "@/lib/engine-build";
import { cn } from "@/lib/utils";

type BuildingBuild = Extract<EngineBuild, { stage: "building" }>;

interface EngineBuildProgressProps {
  build: BuildingBuild;
  /** The splash sits on a dark surface; the setup pages use the app's normal tokens. */
  tone?: "light" | "dark";
  /** Compact drops the full stage list behind a disclosure, for the splash's big type. */
  variant?: "full" | "compact";
  className?: string;
}

function phaseIconClass(state: "done" | "current" | "todo", dark: boolean): string {
  if (state === "done") {
    return "text-green-500";
  }
  if (state === "current") {
    return "text-primary";
  }
  return dark ? "text-neutral-600" : "text-muted-foreground";
}

function PhaseIcon({ state, dark }: { state: "done" | "current" | "todo"; dark: boolean }) {
  const className = cn("h-3.5 w-3.5 shrink-0", phaseIconClass(state, dark));
  if (state === "done") {
    return <CheckCircle2 className={className} aria-hidden="true" />;
  }
  if (state === "current") {
    return <Loader2 className={cn(className, "motion-safe:animate-spin")} aria-hidden="true" />;
  }
  return <Circle className={className} aria-hidden="true" />;
}

function PhaseList({ build, dark }: { build: BuildingBuild; dark: boolean }) {
  return (
    <ul className="space-y-1.5 text-sm" data-testid="list-build-phases">
      {build.phases.map((phase) => (
        <li key={phase.id} className="flex items-start gap-2">
          <span className="mt-0.5">
            <PhaseIcon state={phase.state} dark={dark} />
          </span>
          <span className="min-w-0">
            <span
              className={cn(
                phase.state === "current" && (dark ? "font-medium text-neutral-100" : "font-medium text-foreground"),
                phase.state === "todo" && (dark ? "text-neutral-500" : "text-muted-foreground"),
                phase.state === "done" && (dark ? "text-neutral-300" : "text-muted-foreground")
              )}
            >
              {phase.label}
            </span>
            {phase.state === "current" && (
              <span className={cn("block text-xs", dark ? "text-neutral-400" : "text-muted-foreground")}>
                {phase.detail}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the engine build is doing, for someone who does not know there is an
 * engine. The maintenance API's own steps stay on the admin page; this groups
 * the run into four stages and keeps the bar honest about its progress.
 */
export function EngineBuildProgress({ build, tone = "light", variant = "full", className }: EngineBuildProgressProps) {
  const dark = tone === "dark";
  const current = build.phases.find((phase) => phase.state === "current");
  return (
    <div className={cn("space-y-2", className)} data-testid="engine-build-progress">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        <output
          className={cn("font-medium", dark ? "text-neutral-200" : "text-foreground")}
          aria-live="polite"
          data-testid="text-build-phase"
        >
          {current?.label ?? build.message}
        </output>
        <span className={cn(dark ? "text-neutral-400" : "text-muted-foreground")}>
          {build.percent}% · {buildElapsedLabel(build.elapsedMinutes)}
        </span>
      </div>

      <Progress
        value={build.percent}
        className={cn("h-1.5", dark && "bg-neutral-800")}
        aria-label="Engine setup progress"
      />

      {variant === "full" ? (
        <PhaseList build={build} dark={dark} />
      ) : (
        <details className={cn("group text-sm", dark ? "text-neutral-300" : "text-muted-foreground")}>
          <summary className="cursor-pointer list-none text-xs underline-offset-4 hover:underline">
            What&apos;s happening behind the scenes
          </summary>
          <div className="pt-2">
            <PhaseList build={build} dark={dark} />
          </div>
        </details>
      )}

      <p className={cn("text-xs", dark ? "text-neutral-400" : "text-muted-foreground")} data-testid="text-build-wait">
        {build.slow
          ? "Taking a little longer than usual. Still working on it."
          : "Usually a couple of minutes. You can close this tab; it keeps going."}
      </p>

      {build.slow && build.note && (
        <p className={cn("text-xs", dark ? "text-neutral-500" : "text-muted-foreground")} data-testid="text-build-note">
          Waiting on: {build.note}
        </p>
      )}
    </div>
  );
}
