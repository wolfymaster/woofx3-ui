import type { RpcTarget } from "@woofx3/api/client";

/**
 * Engine shapes for test runs, declared here because the engine checkout this
 * repo builds against may predate them. Must match `TriggerWorkflowOptions`,
 * `TriggerWorkflowResponse`, `UnmetTriggerCondition`, `CancelWorkflowResult`
 * and `MAX_TRIGGER_DATA_BYTES` in woofx3 `shared/clients/typescript/api/api.ts`
 * (wolfymaster/woofx3#172 and #174).
 *
 * Every field is optional on the way back: an engine without those changes
 * answers `triggerWorkflowByName` with the old `{ executionId: "", status:
 * "requested" }` and `cancelWorkflow` with nothing, and both must still work.
 */

/**
 * Lifecycle event for a run someone cancelled, relayed to a caller watching its
 * triggerId. Must match `EngineEventType.WORKFLOW_RUN_CANCELLED` in woofx3
 * `shared/clients/typescript/api/webhooks.ts`.
 */
export const WORKFLOW_RUN_CANCELLED_EVENT_TYPE = "workflow.run.cancelled";

/** Options for running one workflow on request. */
export interface TriggerWorkflowOptions {
  /** Becomes the run's `trigger.data`, as a real event's data would. */
  triggerData?: Record<string, unknown>;
  /** The sample event's platform, for `${trigger.platform}` conditions. Only with `triggerData`. */
  platform?: string;
  /** Run even when `triggerData` fails the trigger conditions. Only with `triggerData`. */
  skipConditions?: boolean;
  /** Steps with side effects record what they would do instead of doing it. */
  dryRun?: boolean;
}

/** Most bytes `triggerData` may encode to as JSON; the engine refuses more. */
export const MAX_TRIGGER_DATA_BYTES = 16 * 1024;

/** A trigger condition a sample payload did not satisfy. */
export interface UnmetTriggerCondition {
  field: string;
  operator: string;
  value: unknown;
  /** Set when the condition could not be evaluated. */
  error?: string;
}

export interface TriggerWorkflowResponse {
  /** Set when the engine answered `started`; empty for `requested`. */
  executionId: string;
  /** `requested` (published, not waited on), `started`, or `conditions_not_met`. */
  status: string;
  message: string;
  triggerId: string;
  eventType?: string;
  unmetConditions?: UnmetTriggerCondition[];
  dryRun?: boolean;
}

export interface CancelWorkflowResult {
  executionId: string;
  /** `cancelled`: stopped (now or before). `already_finished`: it completed or failed first. */
  outcome: "cancelled" | "already_finished";
  /** The run's status after the call. */
  status: string;
  message: string;
}

/**
 * The slice of the engine API test runs use, typed to the engine that has
 * the options. Calls against an older engine still succeed: capnweb passes
 * the extra argument, which the older method ignores.
 */
export interface TestRunEngineApi extends RpcTarget {
  triggerWorkflowByName(
    workflowNameOrId: string,
    parameters?: Record<string, string>,
    userId?: string,
    triggerId?: string,
    triggeredBy?: string,
    options?: TriggerWorkflowOptions
  ): Promise<TriggerWorkflowResponse>;
  /** Returns nothing on an engine whose cancel only marks the history row. */
  cancelWorkflow(executionId: string, reason?: string): Promise<CancelWorkflowResult | undefined | null>;
}

/** UTF-8 bytes `value` encodes to as JSON. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * The options to send for one test run, or the reason there are none.
 *
 * `platform` and `skipConditions` are dropped without `triggerData`: the
 * engine refuses them alone, since there is no sample for them to apply to.
 */
export function buildTriggerOptions(input: {
  triggerData?: Record<string, unknown>;
  platform?: string;
  skipConditions?: boolean;
  dryRun?: boolean;
}): { ok: true; options: TriggerWorkflowOptions } | { ok: false; error: string } {
  const options: TriggerWorkflowOptions = {};
  if (input.triggerData !== undefined) {
    const bytes = jsonByteLength(input.triggerData);
    if (bytes > MAX_TRIGGER_DATA_BYTES) {
      return {
        ok: false,
        error: `The sample is ${Math.ceil(bytes / 1024)} KiB; the engine accepts at most ${MAX_TRIGGER_DATA_BYTES / 1024} KiB.`,
      };
    }
    options.triggerData = input.triggerData;
    if (input.platform) {
      options.platform = input.platform;
    }
    if (input.skipConditions) {
      options.skipConditions = true;
    }
  }
  if (input.dryRun) {
    options.dryRun = true;
  }
  return { ok: true, options };
}

/** The outputs a side-effect step records in a dry run instead of executing. */
export interface DryRunStepOutputs {
  dryRun: true;
  /** A sentence describing the effect the step would have had. */
  wouldDo: string;
}

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
