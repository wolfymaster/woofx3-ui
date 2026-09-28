/**
 * Engine shapes for test runs that the engine does not expose yet.
 *
 * Declared here until the engine test-runs PR (link TBD) lands in the shared
 * API package; must match `triggerWorkflowByName`'s options and the dry-run
 * step outputs there. Nothing sends these options yet: the UI offers dry run
 * only once `ENGINE_SUPPORTS_TEST_RUN_OPTIONS` is true, because an older
 * engine would ignore `dryRun` and perform every step for real.
 */

/** Options for running one workflow on request. */
export interface TriggerWorkflowOptions {
  /** Becomes the run's `trigger.data`, as a real event's data would. */
  triggerData?: Record<string, unknown>;
  /** Run the steps even when the trigger's conditions would reject `triggerData`. */
  skipConditions?: boolean;
  /** Steps with side effects record what they would do instead of doing it. */
  dryRun?: boolean;
}

/** The outputs a side-effect step records in a dry run instead of executing. */
export interface DryRunStepOutputs {
  dryRun: true;
  /** A sentence describing the effect the step would have had. */
  wouldDo: string;
}

/**
 * Whether the engine accepts `TriggerWorkflowOptions`. False until the engine
 * test-runs PR is released and the UI can detect it; flipping it is the one
 * change needed to enable dry run and typed trigger data.
 */
export const ENGINE_SUPPORTS_TEST_RUN_OPTIONS = false;

/**
 * What a dry-run step would have done, read from its recorded outputs JSON.
 * Null for a step that really ran, or outputs that do not parse.
 */
export function dryRunWouldDo(outputs: string | undefined): string | null {
  if (!outputs) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(outputs);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const { dryRun, wouldDo } = parsed as Partial<DryRunStepOutputs>;
    return dryRun === true && typeof wouldDo === "string" && wouldDo !== "" ? wouldDo : null;
  } catch {
    return null;
  }
}
