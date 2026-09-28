import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { unescapeDollarKeys } from "@/lib/dollar-keys";
import { describeTestEventOutcome, type TestEventOutcome } from "@/lib/test-event-outcome";
import { resolveCatalogTrigger } from "@/lib/workflow-node-label";
import type { TriggerPreset } from "@/lib/workflow-presets";
import { toneFor } from "@/lib/workflow-run-timeline";

/**
 * Decisions behind a workflow's Test run sheet, kept out of the components so
 * they can be tested: this repo tests logic under `lib/`, not rendering.
 */

/** The event trigger of a stored workflow definition, or null when it has none. */
export interface WorkflowEventTrigger {
  event: string;
  ref?: string;
}

/**
 * The event a stored definition listens for.
 *
 * Takes the definition as Convex stores it, with `$` keys escaped, so callers
 * can hand over a `workflows` row's `definition` unchanged.
 */
export function workflowEventTrigger(storedDefinition: unknown): WorkflowEventTrigger | null {
  const definition = unescapeDollarKeys(storedDefinition) as { trigger?: unknown } | null | undefined;
  const trigger = definition?.trigger as { type?: unknown; event?: unknown; $ref?: unknown } | undefined;
  if (!trigger || trigger.type !== "event" || typeof trigger.event !== "string" || trigger.event === "") {
    return null;
  }
  return { event: trigger.event, ref: typeof trigger.$ref === "string" ? trigger.$ref : undefined };
}

/**
 * The trigger preset to build a workflow's sample event from, firing the
 * workflow's own event.
 *
 * The event is the workflow's rather than the preset's because some triggers
 * store a longer event than the catalog declares -- a chat command's workflow
 * listens on `chat.command.<name>`, and firing the catalog's bare base would
 * start nothing. Null when the workflow has no event trigger, or its trigger is
 * not in this instance's catalog.
 */
export function testRunPreset(
  trigger: WorkflowEventTrigger,
  catalogTriggers: CatalogTriggerRow[],
  presets: TriggerPreset[]
): TriggerPreset | null {
  const row = resolveCatalogTrigger({ event: trigger.event, ref: trigger.ref }, catalogTriggers);
  const preset = row ? presets.find((entry) => entry.id === row.id) : undefined;
  if (!preset) {
    return null;
  }
  return { ...preset, event: trigger.event };
}

/** The fields of a `workflows` row the warning reads. */
export interface ListeningWorkflow {
  engineWorkflowId: string;
  isEnabled: boolean;
  name: string;
  definition: unknown;
}

/**
 * Other enabled workflows that a simulated `event` would also start, by name.
 *
 * A simulated event is published on the bus like a real one, so every enabled
 * workflow listening for it runs -- overlays, chat messages and all. Their
 * trigger conditions may still filter the sample out; the list is who could
 * run, which is what a person needs to hear before firing.
 */
export function otherWorkflowsOnEvent(workflows: ListeningWorkflow[], selfId: string, event: string): string[] {
  return workflows
    .filter((workflow) => workflow.engineWorkflowId !== selfId && workflow.isEnabled)
    .filter((workflow) => workflowEventTrigger(workflow.definition)?.event === event)
    .map((workflow) => workflow.name)
    .sort((a, b) => a.localeCompare(b));
}

/** The fields of a `transientEvents` row a test run's progress reads. */
export interface TransientRunRow {
  status: "progress" | "success" | "error";
  message?: string;
  data?: unknown;
}

export interface TestRunProgress {
  outcome: TestEventOutcome;
  /** The engine's id for this workflow's run, once it has started. */
  executionId: string | null;
  /** How many other workflows the same test started. */
  otherWorkflowCount: number;
}

function rowField(row: TransientRunRow, key: string): string | undefined {
  const value = (row.data as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * How one workflow's test run is going, from every transient row under the
 * test's correlation key, oldest first.
 *
 * A simulated event can start several workflows under one key, so this reads
 * only the rows naming `engineWorkflowId`. `rows` is undefined while loading;
 * no row for this workflow once `waitElapsed` means it did not run.
 */
export function testRunProgress(
  rows: TransientRunRow[] | undefined,
  engineWorkflowId: string,
  waitElapsed: boolean
): TestRunProgress {
  if (rows === undefined) {
    return { outcome: describeTestEventOutcome(undefined, waitElapsed), executionId: null, otherWorkflowCount: 0 };
  }

  const own = rows.filter((row) => rowField(row, "workflowId") === engineWorkflowId);
  const others = new Set(
    rows.map((row) => rowField(row, "workflowId")).filter((id): id is string => !!id && id !== engineWorkflowId)
  );
  const latest = own.length > 0 ? own[own.length - 1] : null;
  const executionId = own.map((row) => rowField(row, "executionId")).find((id): id is string => !!id) ?? null;

  return {
    outcome: describeTestEventOutcome(latest, waitElapsed),
    executionId,
    otherWorkflowCount: others.size,
  };
}

/**
 * Events a sample must never be published for, because the engine acts on
 * them beyond the workflows listening: going live or offline opens or closes
 * a stream session and marks the channel live everywhere that reads it.
 */
const SESSION_EVENTS = ["stream.online", "stream.offline"];

/**
 * Why a sample of `event` may not be fired, or null when it may. A refused
 * event can still be tested with "This workflow only", which publishes nothing.
 */
export function sampleEventRefusal(event: string | undefined): string | null {
  if (!event) {
    return null;
  }
  const session = SESSION_EVENTS.find((refused) => event === refused || event.startsWith(`${refused}.`));
  if (!session) {
    return null;
  }
  return session === "stream.online"
    ? "A sample going-live event would open a stream session and mark the channel live."
    : "A sample going-offline event would close the current stream session.";
}

/** The fields of a recorded `workflowRuns` row the outcome reads. */
export interface RecordedRunState {
  status: string;
  error?: string;
}

function isAnswer(outcome: TestEventOutcome): boolean {
  return outcome.kind === "running" || outcome.kind === "succeeded" || outcome.kind === "failed";
}

/**
 * The outcome to show for a test run, from everything known about it.
 *
 * The live rows expire a minute after they are written, so a long run outlives
 * them: once they are gone the live outcome reads as "nothing matched". So a
 * recorded run's settled status wins, then a live answer, then the last live
 * answer the caller kept (`sticky`), and only then the live reading as-is.
 */
export function resolveTestRunOutcome(
  live: TestEventOutcome,
  sticky: TestEventOutcome | null,
  recorded: RecordedRunState | null
): TestEventOutcome {
  const recordedTone = recorded ? toneFor(recorded.status) : null;
  if (recorded && recordedTone === "success") {
    return { kind: "succeeded" };
  }
  if (recorded && recordedTone === "failure") {
    if (recorded.status === "cancelled") {
      return { kind: "failed", title: "The run was stopped", detail: recorded.error ?? "Stopped from the dashboard." };
    }
    return describeTestEventOutcome({ status: "error", message: recorded.error }, true);
  }
  if (isAnswer(live)) {
    return live;
  }
  if (sticky) {
    return sticky;
  }
  if (recordedTone === "running") {
    return { kind: "running" };
  }
  return live;
}

/** Whether `outcome` is worth keeping once the live rows expire. */
export function isStickyOutcome(outcome: TestEventOutcome): boolean {
  return isAnswer(outcome);
}
