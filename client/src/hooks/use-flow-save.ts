import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlowSavePhase } from "@/lib/flow-save";
import { storedExpressionProblem } from "@/lib/variable-display";
import type { WorkflowTree } from "@/lib/workflow-tree";

export interface FlowSave {
  changed: boolean;
  phase: FlowSavePhase;
  problem: string | null;
  notSavedYet: string | null;
  /** Saves `next` with the surface's own save, refusing steps with an expression that can't work. */
  commit: (next: WorkflowTree) => Promise<boolean>;
  /** Records `tree` as what is stored, for a copy that came back from the engine. */
  markSaved: (tree: WorkflowTree) => void;
}

/**
 * Whether a flow that saves itself has changes, by comparing it with what was last saved.
 * The comparison rather than an edit flag means undoing an edit by hand reads as no change.
 */
export function useFlowSave(
  tree: WorkflowTree | null,
  save: (next: WorkflowTree) => Promise<boolean>,
  notSavedYet: string | null = null
): FlowSave {
  const [savedJson, setSavedJson] = useState(() => (tree === null ? null : JSON.stringify(tree)));
  const [phase, setPhase] = useState<FlowSavePhase>("idle");

  const changed = tree !== null && savedJson !== null && JSON.stringify(tree) !== savedJson;
  const problem = useMemo(() => (tree === null ? null : storedExpressionProblem(tree.steps)), [tree]);

  useEffect(() => {
    if (!changed) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);

  const commit = useCallback(
    async (next: WorkflowTree): Promise<boolean> => {
      if (storedExpressionProblem(next.steps) !== null) {
        return false;
      }
      setPhase("saving");
      const ok = await save(next);
      setPhase(ok ? "idle" : "failed");
      if (ok) {
        setSavedJson(JSON.stringify(next));
      }
      return ok;
    },
    [save]
  );

  const markSaved = useCallback((stored: WorkflowTree) => {
    setSavedJson(JSON.stringify(stored));
    setPhase("idle");
  }, []);

  return { changed, phase, problem, notSavedYet, commit, markSaved };
}
