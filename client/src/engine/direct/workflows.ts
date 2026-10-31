import { unescapeDollarKeys } from "@shared/dollar-keys";
import { UNRECORDED_ORIGIN } from "@shared/manual-run-origin";
import { BUILTIN_MODULE_LABEL } from "@shared/module-labels";
import { parseViewerFacts } from "@shared/viewer-facts";
import { isStillLoadingError, parseWorkflowHealthList, shouldResync } from "@shared/workflow-health";
import { buildTriggerOptions } from "@shared/workflow-test-run";
import {
  type CallbackEnvelope,
  ENGINE_CAPABILITIES,
  EngineEventType,
  WORKFLOW_RUN_SNAPSHOT_MAX_LIMIT,
} from "@woofx3/api";
import type { WorkflowDefinition } from "@woofx3/api/workflow-definition";
import { useCallback } from "react";
import { GatewayUnsupportedError } from "@/engine/errors";
import type { WorkflowsGateway } from "@/engine/gateway";
import { NoInstanceSelectedError, useEngineScope } from "@/engine/scope";
import type {
  NotRunningWorkflow,
  RecordedWorkflowRun,
  Workflow,
  WorkflowCancelResult,
  WorkflowCatalog,
  WorkflowHealthResyncResult,
  WorkflowHealthResyncTrigger,
  WorkflowReplay,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowTrigger,
  WorkflowTriggerResult,
} from "@/engine/types";
import { directKeys as k } from "./keys";
import {
  type RunLifecycleEvent,
  toNotRunning,
  toRecordedWorkflowRun,
  toWorkflow,
  toWorkflowCatalog,
  toWorkflowRun,
  toWorkflowRunDetail,
} from "./map/workflows";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { readAllWorkflows } from "./workflow-pages";

/** The reason a run stopped from the dashboard carries, as the Convex gateway gives it. */
const CANCEL_REASON = "Cancelled from the dashboard";

export function workflowsRead(runtime: DirectRuntime): EngineRead<Workflow[]> {
  return {
    queryKey: k.workflows.list(),
    queryFn: async () =>
      (await readAllWorkflows(runtime)).flatMap((workflow) => {
        const mapped = toWorkflow(workflow);
        return mapped === null ? [] : [mapped];
      }),
  };
}

function workflowRead(runtime: DirectRuntime, engineWorkflowId: string): EngineRead<Workflow | null> {
  return {
    queryKey: k.workflows.detail(engineWorkflowId),
    queryFn: async () => {
      const workflow = await runtime.call("getWorkflow", (api) => api.getWorkflow(engineWorkflowId));
      return workflow === null ? null : toWorkflow(workflow);
    },
  };
}

function catalogRead(runtime: DirectRuntime): EngineRead<WorkflowCatalog> {
  return {
    queryKey: k.workflows.catalog(),
    queryFn: async () => {
      const [catalog, modules] = await Promise.all([
        runtime.call("getWorkflowCatalog", (api) => api.getWorkflowCatalog()),
        runtime.call("listEngineModules", (api) => api.listEngineModules()),
      ]);
      const labels = new Map(modules.map((module) => [module.moduleId, module.name]));
      return toWorkflowCatalog(catalog, labels, BUILTIN_MODULE_LABEL);
    },
  };
}

function runRead(runtime: DirectRuntime, engineRunId: string): EngineRead<WorkflowRunDetail> {
  return {
    queryKey: k.workflows.run(engineRunId),
    queryFn: async () =>
      toWorkflowRunDetail(
        await runtime.call("getWorkflowRun", (api) => api.getWorkflowRun(engineRunId)),
        runtime.clock.now()
      ),
  };
}

/**
 * One workflow's recorded runs, newest first. The engine refuses a limit
 * outside its range, so one is clamped into it, as the alert list's is.
 */
function runsRead(runtime: DirectRuntime, engineWorkflowId: string, limit: number): EngineRead<RecordedWorkflowRun[]> {
  return {
    queryKey: k.workflows.runs(engineWorkflowId, limit),
    queryFn: async () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.workflowRunSnapshots)) {
        throw new GatewayUnsupportedError("workflows.useRuns");
      }
      const bounded = Math.min(Math.max(Math.trunc(limit), 1), WORKFLOW_RUN_SNAPSHOT_MAX_LIMIT);
      const runs = await runtime.call("listWorkflowRunSnapshots", (api) =>
        api.listWorkflowRunSnapshots({ workflowId: engineWorkflowId, limit: bounded })
      );
      return runs.map(toRecordedWorkflowRun);
    },
  };
}

/**
 * The health errors of enabled workflows. An engine without health reports,
 * or one still loading its workflows, has none to give yet; the second sends
 * a snapshot once it has, which reads this again.
 */
function healthRead(runtime: DirectRuntime): EngineRead<NotRunningWorkflow[]> {
  return {
    queryKey: k.workflows.health(),
    queryFn: async () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.workflowHealth)) {
        return [];
      }
      let raw: unknown;
      try {
        raw = await runtime.call("getWorkflowHealth", (api) => api.getWorkflowHealth());
      } catch (error) {
        if (isStillLoadingError(error)) {
          return [];
        }
        throw error;
      }
      const parsed = parseWorkflowHealthList(raw);
      if (!parsed.ok) {
        throw new Error(`The engine's workflow health is malformed: ${parsed.reason}`);
      }
      const workflows = await runtime.queryClient.fetchQuery(workflowsRead(runtime));
      const enabled = new Set(workflows.filter((w) => w.isEnabled).map((w) => w.engineWorkflowId));
      return toNotRunning(parsed.entries, enabled);
    },
  };
}

/** The run a lifecycle event reports, or null for any other event. */
function lifecycleOf(envelope: CallbackEnvelope): RunLifecycleEvent | null {
  const data = envelope.data;
  switch (data.type) {
    case EngineEventType.WORKFLOW_RUN_STARTED:
      return { kind: "started", ...data };
    case EngineEventType.WORKFLOW_RUN_COMPLETED:
      return { kind: "completed", ...data };
    case EngineEventType.WORKFLOW_RUN_FAILED:
      return { kind: "failed", ...data };
    case EngineEventType.WORKFLOW_RUN_CANCELLED:
      return { kind: "cancelled", ...data };
    default:
      return null;
  }
}

/** The name a workflow's definition gives it, or its id when the list read has not seen it. */
function workflowNameOf(runtime: DirectRuntime, engineWorkflowId: string): string {
  const workflows = runtime.queryClient.getQueryData<Workflow[]>(k.workflows.list()) ?? [];
  const found = workflows.find((workflow) => workflow.engineWorkflowId === engineWorkflowId);
  const name = (found?.definition as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && name !== "" ? name : engineWorkflowId;
}

/**
 * Workflows read from the engine and kept current by its `workflow.*`
 * events. A write resolves once the engine has answered and its reads are
 * marked stale: the engine answers with the workflow it stored, so there is
 * no echo to wait for. Runs started by hand report their progress as
 * transient events under the key the request resolves with.
 */
export function directWorkflowsGateway(runtime: DirectRuntime): WorkflowsGateway {
  const invalidate = (...queryKeys: (readonly unknown[])[]) =>
    Promise.all(queryKeys.map((queryKey) => runtime.queryClient.invalidateQueries({ queryKey })));
  const workflowStale = (engineWorkflowId: string) =>
    invalidate(
      k.workflows.list(),
      k.workflows.detail(engineWorkflowId),
      k.workflows.health(),
      k.scenes.allAlertTargetUsage
    );

  const create = async (definition: unknown) => {
    const created = await runtime.call("createWorkflow", (api) =>
      api.createWorkflow({
        definition: unescapeDollarKeys(definition) as Omit<WorkflowDefinition, "id">,
        correlationKey: crypto.randomUUID(),
      })
    );
    await workflowStale(created.id);
    return { engineWorkflowId: created.id };
  };

  const update = async (engineWorkflowId: string, definition: unknown) => {
    const updated = await runtime.call("updateWorkflow", (api) =>
      api.updateWorkflow(engineWorkflowId, {
        definition: unescapeDollarKeys(definition) as WorkflowDefinition,
        correlationKey: crypto.randomUUID(),
      })
    );
    if (updated === null) {
      throw new Error("That workflow no longer exists on the engine.");
    }
    await workflowStale(updated.id);
    return { engineWorkflowId: updated.id };
  };

  const remove = async (engineWorkflowId: string) => {
    const deleted = await runtime.call("deleteWorkflow", (api) =>
      api.deleteWorkflow(engineWorkflowId, crypto.randomUUID())
    );
    if (!deleted) {
      throw new Error("That workflow no longer exists on the engine.");
    }
    await workflowStale(engineWorkflowId);
    return { deleted: true as const };
  };

  const setEnabled = async (engineWorkflowId: string, isEnabled: boolean) => {
    const result = await runtime.call("setWorkflowEnabled", (api) =>
      api.setWorkflowEnabled(engineWorkflowId, isEnabled, crypto.randomUUID())
    );
    await workflowStale(engineWorkflowId);
    return { isEnabled: result.isEnabled };
  };

  // The key is minted before the call, so a caller can watch for the outcome
  // before the run exists, and a lost answer cannot strand a run nobody can find.
  const trigger = async ({ workflowNameOrId, parameters, origin, options }: WorkflowTrigger) => {
    const built = buildTriggerOptions(options ?? {});
    if (!built.ok) {
      throw new Error(built.error);
    }
    const triggerId = crypto.randomUUID();
    const hasOptions = Object.keys(built.options).length > 0;
    const response = await runtime.call("triggerWorkflowByName", (api) =>
      api.triggerWorkflowByName(
        workflowNameOrId,
        parameters ?? {},
        undefined,
        triggerId,
        origin ?? UNRECORDED_ORIGIN,
        hasOptions ? built.options : undefined
      )
    );
    const result: WorkflowTriggerResult = {
      triggerId,
      status: response.status,
      executionId: response.executionId || null,
      unmetConditions: response.unmetConditions ?? [],
      dryRun: response.dryRun === true,
    };
    return result;
  };

  const viewerFacts = async () =>
    parseViewerFacts(await runtime.call("listViewerFacts", (api) => api.listViewerFacts()));

  const replay = async ({ engineRunId, fromTaskId, origin }: WorkflowReplay) => {
    const triggerId = crypto.randomUUID();
    await runtime.call("replayWorkflowRun", (api) =>
      api.replayWorkflowRun(engineRunId, fromTaskId, triggerId, origin ?? UNRECORDED_ORIGIN)
    );
    return { triggerId };
  };

  const cancelRun = async (engineRunId: string): Promise<WorkflowCancelResult> => {
    const result = await runtime.call("cancelWorkflow", (api) => api.cancelWorkflow(engineRunId, CANCEL_REASON));
    await invalidate(k.workflows.run(engineRunId), k.workflows.allRunLists);
    return { outcome: result.outcome, status: result.status };
  };

  // Throttled like the Convex gateway's resync, by this runtime's clock: one
  // ask per window, the window set by what prompted it.
  let lastResyncAt: number | null = null;
  const healthResync = async (trigger: WorkflowHealthResyncTrigger): Promise<WorkflowHealthResyncResult> => {
    const now = runtime.clock.now();
    if (!shouldResync(lastResyncAt, now, trigger)) {
      return "skipped";
    }
    lastResyncAt = now;
    if (!runtime.supports(ENGINE_CAPABILITIES.workflowHealth)) {
      return "unsupported";
    }
    try {
      await runtime.call("getWorkflowHealth", (api) => api.getWorkflowHealth());
    } catch (error) {
      if (isStillLoadingError(error)) {
        lastResyncAt = null;
        return "loading";
      }
      runtime.logger.warn("workflow health: resync failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "failed";
    }
    await invalidate(k.workflows.health());
    return "ok";
  };

  return {
    useWorkflows: () => useEngineQuery(runtime, workflowsRead(runtime)),
    useHasAny: () => useEngineQuery(runtime, workflowsRead(runtime), { select: hasAny }),
    useWorkflow: (engineWorkflowId) =>
      useEngineQuery(runtime, workflowRead(runtime, engineWorkflowId ?? ""), { enabled: engineWorkflowId !== null }),
    useCatalog: () => useEngineQuery(runtime, catalogRead(runtime)),
    useCreateRequest: () => useEngineRequest(create),
    useUpdateRequest: () => useEngineRequest(update),
    useRemoveRequest: () => useEngineRequest(remove),
    useSetEnabledRequest: () => useEngineRequest(setEnabled),
    useTriggerRequest: () => useEngineRequest(trigger),
    useViewerFactsRequest: () => useEngineRequest(viewerFacts),
    useReplayRequest: () => useEngineRequest(replay),
    useCancelRunRequest: () => useEngineRequest(cancelRun),
    useRun: (engineRunId) =>
      useEngineQuery(runtime, runRead(runtime, engineRunId ?? ""), { enabled: engineRunId !== null }),
    useRuns: (engineWorkflowId, limit) => useEngineQuery(runtime, runsRead(runtime, engineWorkflowId, limit)),
    useRunsSubscription: () => {
      const { instanceId } = useEngineScope();
      return useCallback(
        (onRun: (run: WorkflowRun) => void) => {
          if (instanceId === null) {
            throw new NoInstanceSelectedError();
          }
          const runs = new Map<string, WorkflowRun>();
          return runtime.connection.onEvent((envelope) => {
            const event = lifecycleOf(envelope);
            if (event === null) {
              return;
            }
            const run = toWorkflowRun(event, runs.get(event.executionId), workflowNameOf(runtime, event.workflowId));
            // Only a run still going needs its start remembered.
            if (run.completedAt === undefined) {
              runs.set(run.id, run);
            } else {
              runs.delete(run.id);
            }
            onRun(run);
          });
        },
        [instanceId, runtime]
      );
    },
    useNotRunning: () => useEngineQuery(runtime, healthRead(runtime)),
    useHealthResyncRequest: () => useEngineRequest(healthResync),
  };
}

function hasAny(workflows: Workflow[]): boolean {
  return workflows.length > 0;
}
