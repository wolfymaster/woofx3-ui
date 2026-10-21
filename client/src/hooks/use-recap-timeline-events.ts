import type { Id } from "@convex/_generated/dataModel";
import type { RecapTimelineEvents } from "@convex/lib/streamRecap";
import { useEffect, useState } from "react";
import { useRecapTimelineEventsRequest } from "@/engine/hooks/use-stream-recap";

export type RecapTimelineEventsState =
  | { kind: "loading" }
  | { kind: "loaded"; result: RecapTimelineEvents }
  | { kind: "error"; message: string };

/**
 * Loads a recap's events for the timeline when `enabled`, which the page sets
 * only for an engine that lists `analytics.sessionEvents`. Like the engine
 * detail, a session still in progress loads again on a new `refreshKey`, and
 * the events on screen stay while that runs or if it fails.
 */
export function useRecapTimelineEvents(
  instanceId: Id<"instances">,
  sessionId: string,
  enabled: boolean,
  refreshKey = 0
) {
  const loadTimelineEvents = useRecapTimelineEventsRequest();
  const [state, setState] = useState<RecapTimelineEventsState>({ kind: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a deliberate re-run trigger
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.kind === "loaded" ? prev : { kind: "loading" }));
    loadTimelineEvents(instanceId, sessionId)
      .then((result) => {
        if (!cancelled) {
          setState({ kind: "loaded", result });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setState((prev) => (prev.kind === "loaded" ? prev : { kind: "error", message }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, sessionId, enabled, loadTimelineEvents, refreshKey]);

  return state;
}
