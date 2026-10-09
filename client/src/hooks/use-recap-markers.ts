import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { RecapMarkersResult } from "@convex/streamRecap";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";

export type RecapMarkersState =
  | { kind: "loading" }
  | { kind: "loaded"; result: RecapMarkersResult }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    return String(error.data);
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads the stream markers placed during a recapped session, once per visit.
 * Held in component state only, like clips: markers live on Twitch's VODs and
 * the dashboard never stores them.
 */
export function useRecapMarkers(instanceId: Id<"instances">, sessionId: string) {
  const loadMarkers = useAction(api.streamRecap.loadMarkers);
  const [state, setState] = useState<RecapMarkersState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    loadMarkers({ instanceId, sessionId })
      .then((result) => {
        if (!cancelled) {
          setState({ kind: "loaded", result });
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
  }, [instanceId, sessionId, loadMarkers]);

  return state;
}
