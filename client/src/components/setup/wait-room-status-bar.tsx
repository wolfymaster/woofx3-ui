import { Activity } from "lucide-react";
import type { EngineBuild } from "@/lib/engine-build";

type BuildingBuild = Extract<EngineBuild, { stage: "building" }>;

/**
 * The splash's bottom bar, shaped like the dashboard's so the wait already
 * looks like the place it leads to. There is no engine to ask yet, so the
 * phase and percent come from the build itself and the live segments stay at
 * their offline values.
 */
export function WaitRoomStatusBar({ build }: { build: BuildingBuild }) {
  const phase = build.phases.find((candidate) => candidate.state === "current")?.label ?? build.message;

  return (
    <div
      className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-card px-4 text-xs text-card-foreground"
      data-testid="wait-room-status-bar"
    >
      <span className="flex shrink-0 items-center gap-1.5" data-testid="wait-room-engine-state">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden="true" />
        <span className="font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Starting</span>
      </span>
      <span className="text-muted-foreground/60" aria-hidden="true">
        |
      </span>
      <output className="min-w-0 truncate text-muted-foreground" aria-live="polite" data-testid="wait-room-phase">
        {phase}
      </output>
      <span className="shrink-0 text-muted-foreground" data-testid="wait-room-percent">
        {build.percent}%
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1.5" data-testid="wait-room-live-state">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">Offline</span>
        </span>
        <span
          className="flex items-center gap-1.5 font-system-mono text-muted-foreground"
          data-testid="wait-room-uptime"
        >
          <Activity className="h-3 w-3" aria-hidden="true" />
          00:00:00
        </span>
      </div>
    </div>
  );
}
