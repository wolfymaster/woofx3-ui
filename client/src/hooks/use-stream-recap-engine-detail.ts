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
 */
export function useStreamRecapEngineDetail(
  instanceId: Id<"instances"> | undefined,
  sessionId: string,
  enabled: boolean
) {
  const loadEngineDetail = useAction(api.streamRecap.loadEngineDetail);
  const [state, setState] = useState<StreamRecapEngineState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is a deliberate re-run trigger for retry
  useEffect(() => {
    if (!instanceId || !enabled) {
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    loadEngineDetail({ instanceId, sessionId })
      .then((detail) => {
        if (!cancelled) {
          setState({ kind: "loaded", detail });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, sessionId, enabled, loadEngineDetail, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
}
