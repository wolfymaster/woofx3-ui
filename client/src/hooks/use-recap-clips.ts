import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { RecapClip } from "@convex/lib/recapClips";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useState } from "react";

export type RecapClipsState =
  | { kind: "loading" }
  | { kind: "loaded"; clips: RecapClip[] }
  | { kind: "never_live" }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    return String(error.data);
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads the clips made during a recapped session. Held in component state
 * only: clips are never stored by the dashboard, and each visit (or refresh)
 * asks Twitch again so view counts and deletions are current.
 */
export function useRecapClips(instanceId: Id<"instances">, sessionId: string) {
  const loadClips = useAction(api.streamRecap.loadClips);
  const [state, setState] = useState<RecapClipsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is a deliberate re-run trigger for refresh
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    loadClips({ instanceId, sessionId })
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
          setState({ kind: "error", message: errorMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, sessionId, loadClips, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, reload };
}
