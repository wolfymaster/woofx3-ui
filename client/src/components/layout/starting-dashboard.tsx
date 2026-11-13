import { useEngineStarting } from "@/hooks/use-engine-starting";

/**
 * Stands in for every engine-dependent page while the engine is being built:
 * the real shell around pulsing panels, so nothing asks an engine that does
 * not exist yet.
 */
export function StartingDashboard() {
  const starting = useEngineStarting();
  return (
    <div className="relative h-full p-4 grid grid-cols-3 grid-rows-2 gap-4" data-testid="starting-dashboard">
      {Array.from({ length: 6 }, (_, panel) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: identical decorative panels, never reordered
          key={panel}
          className="rounded-lg border border-border bg-card animate-pulse"
          aria-hidden="true"
        />
      ))}
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <p className="rounded-lg border border-border bg-background/90 px-4 py-3 text-sm shadow-sm text-center">
          Your engine is starting{starting ? `: ${starting.phase.toLowerCase()}` : ""}. This page fills in when it is
          ready.
        </p>
      </div>
    </div>
  );
}
