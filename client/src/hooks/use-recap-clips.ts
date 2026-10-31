import { useCallback, useEffect, useState } from "react";
import { useEngineScope } from "@/engine/context";
import { useRecapClipsRequest, useStreamOpsSupport } from "@/engine/hooks/use-stream-recap";
import type { RecapClip } from "@/engine/types";

export type RecapClipsState =
  | { kind: "loading" }
  | { kind: "loaded"; clips: RecapClip[] }
  | { kind: "never_live" }
  | { kind: "error"; message: string }
  /** This connection to the engine cannot list clips, so there is nothing to load or show. */
  | { kind: "unsupported" };

const UNSUPPORTED: RecapClipsState = { kind: "unsupported" };

/**
 * Loads the clips made during a recapped session. Held in component state
 * only: clips are never stored by the dashboard, and each visit (or refresh)
 * asks Twitch again so view counts and deletions are current.
 */
export function useRecapClips(sessionId: string) {
  const { instanceId } = useEngineScope();
  const supported = useStreamOpsSupport().recapClips;
  const loadClips = useRecapClipsRequest();
  const [state, setState] = useState<RecapClipsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is a deliberate re-run trigger for refresh
  useEffect(() => {
    if (!supported || !instanceId) {
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    loadClips(sessionId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.status === "never_live") {
          setState({ kind: "never_live" });
        } else {
          setState({ kind: "loaded", clips: result.clips });
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
  }, [instanceId, sessionId, supported, loadClips, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { state: supported ? state : UNSUPPORTED, reload };
}
