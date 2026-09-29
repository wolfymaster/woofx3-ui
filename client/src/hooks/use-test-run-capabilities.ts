import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OptionsSupport } from "@convex/lib/engineTestRun";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

/** `checking` while the probe is out; otherwise what the engine answered. */
export type TestRunOptionsState = OptionsSupport | "checking";

/**
 * Answers already known this session, by instance. An engine's version does
 * not change under a running dashboard often enough to probe on every sheet
 * open; a reload probes again. `unknown` is never kept, so an engine that was
 * unreachable is asked again next time.
 */
const known = new Map<string, Exclude<OptionsSupport, "unknown">>();

/**
 * Record that an instance's engine ignored test-run options it was sent, for
 * when a real call reveals what the probe did not.
 */
export function rememberOptionsUnsupported(instanceId: Id<"instances">): void {
  known.set(instanceId, "unsupported");
}

/**
 * Whether the instance's engine takes test-run options: sample trigger data
 * for one workflow, skipping conditions, and dry runs. See
 * `workflowActions.testRunCapabilities` for how it is asked without starting
 * a run.
 */
export function useTestRunOptions(instanceId: Id<"instances"> | undefined): TestRunOptionsState {
  const probe = useAction(api.workflowActions.testRunCapabilities);
  const [state, setState] = useState<TestRunOptionsState>(() =>
    instanceId ? (known.get(instanceId) ?? "checking") : "checking"
  );

  useEffect(() => {
    if (!instanceId) {
      return;
    }
    const cached = known.get(instanceId);
    if (cached) {
      setState(cached);
      return;
    }
    let cancelled = false;
    setState("checking");
    probe({ instanceId })
      .then(({ options }) => {
        if (options !== "unknown") {
          known.set(instanceId, options);
        }
        if (!cancelled) {
          setState(options);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState("unknown");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, probe]);

  return state;
}
