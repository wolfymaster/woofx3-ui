import { useEngineScope } from "@/engine/context";
import { useEngineCapabilities } from "@/engine/hooks/use-engine-capabilities";
import type { InstanceId } from "@/engine/types";
import { type CapabilitySupport, type TestRunSupport, testRunSupport } from "@/lib/engine-capabilities";

/** `checking` while the engine is being asked; otherwise what it answered. */
export type TestRunOptionsState = CapabilitySupport;

/** Instances whose engine ignored test-run options it was sent, whatever it claimed. */
const ignoredOptions = new Set<string>();

/**
 * Record that an instance's engine ignored test-run options it was sent, for
 * when a real call reveals what capabilities did not.
 */
export function rememberOptionsUnsupported(instanceId: InstanceId): void {
  ignoredOptions.add(instanceId);
}

/**
 * What the instance's engine supports for test runs: sample trigger data and
 * skipping conditions for one workflow, dry runs, and a Stop that halts a run.
 */
export function useTestRunSupport(): TestRunSupport {
  const { instanceId } = useEngineScope();
  const { state } = useEngineCapabilities();
  const support = testRunSupport(state);
  if (instanceId && ignoredOptions.has(instanceId)) {
    return { ...support, options: "unsupported", dryRun: "unsupported" };
  }
  return support;
}
