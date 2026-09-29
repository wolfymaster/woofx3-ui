import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { OptionsSupport } from "@convex/lib/engineTestRun";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { type TestRunSupport, testRunSupport } from "@/lib/engine-capabilities";

/** `checking` while the engine is being asked; otherwise what it answered. */
export type TestRunOptionsState = OptionsSupport | "checking";

/**
 * Probe answers for engines that predate capabilities, by instance. Updating
 * such an engine brings capabilities, which then answer instead, so a probe
 * answer holds for the page session. `unknown` is never kept, so an engine
 * that was unreachable is asked again next time.
 */
const probed = new Map<string, Exclude<OptionsSupport, "unknown">>();

/** Instances whose engine ignored test-run options it was sent, whatever it claimed. */
const ignoredOptions = new Set<string>();

/**
 * Record that an instance's engine ignored test-run options it was sent, for
 * when a real call reveals what neither capabilities nor the probe did.
 */
export function rememberOptionsUnsupported(instanceId: Id<"instances">): void {
  ignoredOptions.add(instanceId);
  probed.set(instanceId, "unsupported");
}

/** Probes only when `enabled`; see `workflowActions.testRunCapabilities`. */
function useLegacyOptionsProbe(instanceId: Id<"instances"> | undefined, enabled: boolean): TestRunOptionsState {
  const probe = useAction(api.workflowActions.testRunCapabilities);
  const [state, setState] = useState<TestRunOptionsState>(() =>
    instanceId ? (probed.get(instanceId) ?? "checking") : "checking"
  );

  useEffect(() => {
    if (!instanceId || !enabled) {
      return;
    }
    const cached = probed.get(instanceId);
    if (cached) {
      setState(cached);
      return;
    }
    let cancelled = false;
    setState("checking");
    probe({ instanceId })
      .then(({ options }) => {
        if (options !== "unknown") {
          probed.set(instanceId, options);
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
  }, [instanceId, enabled, probe]);

  return state;
}

/**
 * What the instance's engine supports for test runs: sample trigger data and
 * skipping conditions for one workflow, dry runs, and a Stop that halts a run.
 */
export function useTestRunSupport(instanceId: Id<"instances"> | undefined): TestRunSupport {
  const { state } = useEngineCapabilities(instanceId);
  const legacy = state.status === "ready" && state.report.legacy;
  const legacyProbe = useLegacyOptionsProbe(instanceId, legacy);
  const support = testRunSupport(state, legacyProbe);
  if (instanceId && ignoredOptions.has(instanceId)) {
    return { ...support, options: "unsupported", dryRun: "unsupported" };
  }
  return support;
}
