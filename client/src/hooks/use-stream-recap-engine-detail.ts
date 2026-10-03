import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { StreamRecapEngineDetail } from "@convex/lib/streamRecap";
import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";

export type StreamRecapEngineState =
  | { kind: "loading" }
  | { kind: "loaded"; detail: StreamRecapEngineDetail }
  | { kind: "error"; message: string };

/**
 * Loads a recap's engine-held detail once per session. It is a one-off action
 * rather than a subscription: a finished session's samples and leaderboards
 * do not change while the page is open, and the engine may not be reachable.
 *
 * A session still in progress does change, so a new `refreshKey` (the stored
 * summary's `generatedAtMs`) loads it again. That reload keeps the detail
 * already on screen while it runs, and keeps it if the reload fails.
 */
export function useStreamRecapEngineDetail(
  instanceId: Id<"instances"> | undefined,
  sessionId: string,
  enabled: boolean,
  refreshKey = 0
) {
  const loadEngineDetail = useAction(api.streamRecap.loadEngineDetail);
  const [state, setState] = useState<StreamRecapEngineState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt and refreshKey are deliberate re-run triggers
  useEffect(() => {
    if (!instanceId || !enabled) {
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.kind === "loaded" ? prev : { kind: "loading" }));
    loadEngineDetail({ instanceId, sessionId })
      .then((detail) => {
        if (!cancelled) {
          setState({ kind: "loaded", detail });
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
  }, [instanceId, sessionId, enabled, loadEngineDetail, attempt, refreshKey]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
}
