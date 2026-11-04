import { useEffect, useMemo, useState } from "react";
import { useEngineScope } from "@/engine/context";
import { useViewerFactsRequest } from "@/engine/hooks/use-workflows";
import type { InstanceId } from "@/engine/types";
import type { EngineConditionSupport } from "@/lib/condition-builder";
import type { ViewerFact, ViewerFactsState } from "@/lib/viewer-facts";

/**
 * The values `${viewer.*}` resolves on the instance's engine, read once per instance
 * while `enabled`.
 */
export function useViewerFacts(enabled: boolean): ViewerFactsState {
  const { instanceId } = useEngineScope();
  const listFacts = useViewerFactsRequest();
  const [loaded, setLoaded] = useState<{ instanceId: InstanceId; result: ViewerFact[] | "failed" } | null>(null);
  const ask = Boolean(instanceId) && enabled;
  const current = loaded && loaded.instanceId === instanceId ? loaded.result : null;

  useEffect(() => {
    if (!ask || !instanceId || current !== null) {
      return;
    }
    let cancelled = false;
    listFacts()
      .then((facts) => {
        if (!cancelled) {
          setLoaded({ instanceId, result: facts });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ instanceId, result: "failed" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ask, instanceId, current, listFacts]);

  return useMemo((): ViewerFactsState => {
    if (current === null) {
      return { status: "loading" };
    }
    return current === "failed" ? { status: "unavailable", reason: "failed" } : { status: "ready", facts: current };
  }, [current]);
}

/** What the instance's engine lets the condition builder offer; see EngineConditionSupport. */
export function useEngineConditionSupport(): EngineConditionSupport {
  const viewerFacts = useViewerFacts(true);
  return useMemo(() => ({ viewerFacts }), [viewerFacts]);
}
