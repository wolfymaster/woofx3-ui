import { useEffect, useMemo, useState } from "react";
import { useEngineCapabilities } from "@/engine/hooks/use-engine-capabilities";
import { useViewerFactsRequest } from "@/engine/hooks/use-workflows";
import type { InstanceId } from "@/engine/types";
import type { EngineConditionSupport } from "@/lib/condition-builder";
import type { ViewerFact, ViewerFactsState } from "@/lib/viewer-facts";

/**
 * The values `${viewer.*}` resolves on the instance's engine, read once per instance
 * while `enabled`. Only engines with `workflow.viewerFacts` are asked.
 */
export function useViewerFacts(instanceId: InstanceId | null, enabled: boolean): ViewerFactsState {
  const support = useEngineCapabilities(instanceId).support("workflow.viewerFacts");
  const listFacts = useViewerFactsRequest();
  const [loaded, setLoaded] = useState<{ instanceId: InstanceId; result: ViewerFact[] | "failed" } | null>(null);
  const ask = Boolean(instanceId) && enabled && support === "supported";
  const current = loaded && loaded.instanceId === instanceId ? loaded.result : null;

  useEffect(() => {
    if (!ask || !instanceId || current !== null) {
      return;
    }
    let cancelled = false;
    listFacts(instanceId)
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
    if (support === "checking") {
      return { status: "loading" };
    }
    if (support !== "supported") {
      return { status: "unavailable", reason: support === "unknown" ? "failed" : "unsupported" };
    }
    if (current === null) {
      return { status: "loading" };
    }
    return current === "failed" ? { status: "unavailable", reason: "failed" } : { status: "ready", facts: current };
  }, [support, current]);
}

/** What the instance's engine lets the condition builder offer; see EngineConditionSupport. */
export function useEngineConditionSupport(instanceId: InstanceId | null): EngineConditionSupport {
  const capabilities = useEngineCapabilities(instanceId);
  const viewerFacts = useViewerFacts(instanceId, true);
  const listReferences = capabilities.support("workflow.conditionListReferences") === "supported";
  return useMemo(() => ({ viewerFacts, listReferences }), [viewerFacts, listReferences]);
}
