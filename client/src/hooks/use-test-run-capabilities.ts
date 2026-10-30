import { useEngineCapabilities } from "@/engine/hooks/use-engine-capabilities";
import { type CapabilitySupport, type TestRunSupport, testRunSupport } from "@/lib/engine-capabilities";

/** `checking` while the engine is being asked; otherwise what it answered. */
export type TestRunOptionsState = CapabilitySupport;

/**
 * What the instance's engine supports for test runs: sample trigger data and
 * skipping conditions for one workflow, dry runs, and a Stop that halts a run.
 */
export function useTestRunSupport(): TestRunSupport {
  const { state } = useEngineCapabilities();
  return testRunSupport(state);
}
