import { useEffect, useState } from "react";
import { useEngineScope } from "@/engine/context";
import { useRecapMarkersRequest, useStreamOpsSupport } from "@/engine/hooks/use-stream-recap";
import type { RecapMarkers } from "@/engine/types";

export type RecapMarkersState =
  | { kind: "loading" }
  | { kind: "loaded"; result: RecapMarkers }
  | { kind: "error"; message: string }
  /** This connection to the engine cannot list markers, so there is nothing to load or show. */
  | { kind: "unsupported" };

const UNSUPPORTED: RecapMarkersState = { kind: "unsupported" };

/**
 * Loads the stream markers placed during a recapped session, once per visit.
 * Held in component state only, like clips: markers live on Twitch's VODs and
 * the dashboard never stores them.
 */
export function useRecapMarkers(sessionId: string): RecapMarkersState {
  const { instanceId } = useEngineScope();
  const supported = useStreamOpsSupport().recapMarkers;
  const loadMarkers = useRecapMarkersRequest();
  const [state, setState] = useState<RecapMarkersState>({ kind: "loading" });

  useEffect(() => {
    if (!supported || !instanceId) {
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    loadMarkers(sessionId)
      .then((result) => {
        if (!cancelled) {
          setState({ kind: "loaded", result });
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
  }, [instanceId, sessionId, supported, loadMarkers]);

  return supported ? state : UNSUPPORTED;
}
