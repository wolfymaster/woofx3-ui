import { COUNTER_KIND, resolveResourceKind, rowsOfKind } from "@shared/resource-kinds";
import {
  applyImportItem,
  type ImportEngine,
  type ImportItemOutcome,
  type ImportOutcome,
  type StoredImportItem,
} from "@shared/setup-import/apply";
import { convertDocument, ImportDocumentError, type PlannedItem, planItems } from "@shared/setup-import/plan";
import { IMPORT_SOURCES, type ImportItemKind } from "@shared/setup-import/types";
import { appendSteps, findMergeTarget, isModuleWorkflowName, type MergeWorkflowFields } from "@shared/workflow-merge";
import type { UISetting } from "@woofx3/api";
import type { WorkflowDefinition } from "@woofx3/api/workflow-definition";
import { useMemo } from "react";
import { z } from "zod";
import type { SetupImportsGateway } from "@/engine/gateway";
import type { SetupImportAnalysis, SetupImportId, SetupImportReport } from "@/engine/types";
import { groupsRead } from "./commands";
import { fromSetupImportId, toSetupImportId } from "./ids";
import { directKeys as k } from "./keys";
import { normalizeUsername } from "./map/commands";
import { toKindDeclarers, toModuleResourceInstance } from "./map/module-resources";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { toStarterCatalog } from "./starter-packs";
import {
  parseSetting,
  removeUISetting,
  storeUISetting,
  toSettingValue,
  UI_SETTING_NAMESPACES,
  uiSettingsRead,
} from "./ui-settings";
import { readAllWorkflows } from "./workflow-pages";
import { catalogRead } from "./workflows";

// An engine does not keep a streamer's imports, so the dashboard keeps them in
// the engine's UI settings, one setting per import and one per item, so that
// no setting nears the engine's size limit however large the import. The
// streamer's own app does the creating, item by item, as it goes; an import it
// was in the middle of when the app closed is picked up again with "Try again".

const MEMBER = "setupImports";
const NAMESPACE = UI_SETTING_NAMESPACES.setupImports;

const RUN_PREFIX = "run:";
const ITEM_PREFIX = "item:";
/** Wide enough for the most items an import takes, so item keys sort in creation order. */
const ITEM_ORDER_DIGITS = 5;

const noteSchema = z.object({ message: z.string(), detail: z.string().optional(), blocking: z.boolean().optional() });

const runSchema = z.object({
  id: z.string(),
  source: z.enum(IMPORT_SOURCES),
  label: z.string(),
  status: z.enum(["review", "queued", "applying", "done"]),
  createdAt: z.number(),
  leftovers: z.array(
    z.object({ origin: z.string(), name: z.string(), message: z.string(), detail: z.string().optional() })
  ),
});

const OUTCOMES = ["created", "exists", "needs_module", "skipped", "pending", "failed"] as const;

const itemSchema = z.object({
  importId: z.string(),
  order: z.number(),
  key: z.string(),
  kind: z.enum(["group", "counter", "command", "workflow"]),
  name: z.string(),
  origin: z.string(),
  readiness: z.enum(["ready", "partial", "unsupported"]),
  notes: z.array(noteSchema),
  steps: z.array(z.string()),
  spec: z.unknown(),
  outcome: z.enum(OUTCOMES).optional(),
  message: z.string().optional(),
  engineId: z.string().optional(),
});

type StoredRun = z.infer<typeof runSchema>;
type StoredItem = z.infer<typeof itemSchema> & { storeKey: string };

const runKey = (importId: string) => `${RUN_PREFIX}${importId}`;
const itemKey = (importId: string, order: number) =>
  `${ITEM_PREFIX}${importId}:${String(order).padStart(ITEM_ORDER_DIGITS, "0")}`;

interface StoredImports {
  runs: StoredRun[];
  items: Map<string, StoredItem[]>;
}

function readStored(runtime: DirectRuntime, settings: readonly UISetting[]): StoredImports {
  const runs: StoredRun[] = [];
  const items = new Map<string, StoredItem[]>();
  for (const setting of settings) {
    if (setting.key.startsWith(RUN_PREFIX)) {
      const run = parseSetting(runtime.logger, runSchema, setting);
      if (run !== null) {
        runs.push(run);
      }
    } else if (setting.key.startsWith(ITEM_PREFIX)) {
      const item = parseSetting(runtime.logger, itemSchema, setting);
      if (item !== null) {
        items.set(item.importId, [...(items.get(item.importId) ?? []), { ...item, storeKey: setting.key }]);
      }
    }
  }
  for (const list of items.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  return { runs, items };
}

/** The moves a stored import makes. "queued" is only ever shown, for an import the app was cut off from, never stored. */
const RUN_TRANSITIONS: Record<StoredRun["status"], readonly StoredRun["status"][]> = {
  review: ["applying"],
  queued: [],
  applying: ["applying", "done"],
  done: ["applying"],
};

function movedTo(run: StoredRun, status: StoredRun["status"]): StoredRun {
  if (!RUN_TRANSITIONS[run.status].includes(status)) {
    throw new Error(`${MEMBER}: an import cannot go from ${run.status} to ${status}`);
  }
  return { ...run, status };
}

function latestRun(runs: readonly StoredRun[]): StoredRun | null {
  return runs.reduce<StoredRun | null>(
    (latest, run) => (latest === null || run.createdAt > latest.createdAt ? run : latest),
    null
  );
}

function toReport(run: StoredRun, items: readonly StoredItem[], applying: boolean): SetupImportReport {
  // A run the store says is being applied, with no apply under way in this
  // app, was cut off by the app closing; it waits for "Try again".
  const cutOff = (run.status === "queued" || run.status === "applying") && !applying;
  return {
    id: toSetupImportId(run.id),
    source: run.source,
    label: run.label,
    status: cutOff ? "queued" : run.status,
    createdAt: run.createdAt,
    waitingFor: null,
    stalled: cutOff,
    leftovers: run.leftovers,
    items: items.map((item) => ({
      id: item.storeKey,
      kind: item.kind,
      name: item.name,
      origin: item.origin,
      readiness: item.readiness,
      notes: item.notes,
      steps: item.steps,
      outcome: item.outcome ?? null,
      message: item.message ?? null,
    })),
  };
}

function toStoredItem(item: StoredItem): StoredImportItem {
  return {
    ref: item.storeKey,
    key: item.key,
    kind: item.kind,
    name: item.name,
    origin: item.origin,
    notes: item.notes,
    readiness: item.readiness,
    spec: item.spec,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface WorkflowCandidate extends MergeWorkflowFields {
  id: string;
  definition: WorkflowDefinition;
}

/**
 * The engine as an import sees it when the dashboard talks to it directly: the
 * engine's own lists answer what exists, kept up to date as the import adds to
 * them, and an earlier import's items answer which workflows it already made.
 */
async function directImportEngine(
  runtime: DirectRuntime,
  run: StoredRun,
  earlierWorkflowIds: ReadonlyMap<string, readonly string[]>
): Promise<ImportEngine> {
  const [catalog, groups, commands, resourceInstances, modules, workflows] = await Promise.all([
    runtime.queryClient.fetchQuery({ ...catalogRead(runtime), staleTime: 0 }),
    runtime.queryClient.fetchQuery({ ...groupsRead(runtime), staleTime: 0 }),
    runtime.call("listCommands", (api) => api.listCommands()),
    runtime.call("listAllResourceInstances", (api) => api.listAllResourceInstances()),
    runtime.call("listEngineModules", (api) => api.listEngineModules()),
    readAllWorkflows(runtime),
  ]);
  const counterOwner = resolveResourceKind(toKindDeclarers(modules), COUNTER_KIND)?.moduleName;
  const counters = new Map(
    rowsOfKind(resourceInstances.map(toModuleResourceInstance), "counter", counterOwner).map((counter) => [
      counter.resourceInstanceId,
      counter.canonicalId,
    ])
  );
  const groupIds = new Map(groups.map((group) => [group.name.toLowerCase(), group.engineGroupId]));
  const builtIn = new Map(
    groups.filter((group) => group.isBuiltIn === true).map((group) => [group.name, group.engineGroupId])
  );
  const commandIds = new Map(commands.map((command) => [command.command.toLowerCase(), command.id]));
  const workflowIds = new Set(workflows.map((workflow) => workflow.id));
  const candidates: WorkflowCandidate[] = workflows.flatMap((workflow) =>
    workflow.definition === null
      ? []
      : [
          {
            id: workflow.id,
            isEnabled: workflow.isEnabled,
            managed: isModuleWorkflowName(workflow.name),
            definition: workflow.definition,
          },
        ]
  );

  const existingLookups: Record<ImportItemKind, (item: StoredImportItem, name: string) => string | undefined> = {
    group: (_item, name) => groupIds.get(name.toLowerCase()),
    counter: (_item, name) => counters.get(name),
    command: (_item, name) => commandIds.get(name.toLowerCase()),
    // A workflow has no unique name; it is the same one only when an earlier
    // import of the same file created it and it still exists.
    workflow: (item) => (earlierWorkflowIds.get(item.key) ?? []).find((id) => workflowIds.has(id)),
  };

  return {
    source: run.source,
    catalog: toStarterCatalog(catalog),
    findExisting: async (kind, item, name) => {
      const engineId = existingLookups[kind](item, name);
      return engineId === undefined ? null : { engineId };
    },
    counterModule: async () => counterOwner ?? null,
    createCounter: async (moduleName, spec) => {
      const created = await runtime.call("createResourceInstance", (api) =>
        api.createResourceInstance(moduleName, "counter", spec.resourceInstanceId, spec.displayName, {
          lifetime: "forever",
          initialValue: spec.initialValue,
          step: 1,
        })
      );
      counters.set(spec.resourceInstanceId, created.canonicalId);
      return created.canonicalId;
    },
    builtInGroupIds: async (names) =>
      Object.fromEntries(names.flatMap((name) => (builtIn.has(name) ? [[name, builtIn.get(name) as string]] : []))),
    createGroup: async (group) => {
      const created = await runtime.call("createGroup", (api) =>
        api.createGroup({ name: group.name, description: group.description, correlationKey: crypto.randomUUID() })
      );
      groupIds.set(group.name.toLowerCase(), created.id);
      return created.id;
    },
    addGroupMember: async (engineGroupId, username) => {
      await runtime.call("addUserToGroup", (api) => api.addUserToGroup(engineGroupId, normalizeUsername(username)));
    },
    createCommand: async (command) => {
      const created = await runtime.call("createCommand", (api) =>
        api.createCommand({ ...command, correlationKey: crypto.randomUUID() })
      );
      commandIds.set(command.command.toLowerCase(), created.id);
      return created.id;
    },
    placeWorkflow: async (_item, definition, enabled) => {
      const target = findMergeTarget(candidates, definition.trigger as Record<string, unknown>);
      if (target === undefined) {
        const created = await runtime.call("createWorkflow", (api) =>
          api.createWorkflow({
            // Carries delay waits and `$ref`s, which the shared WorkflowDefinition type does not model.
            definition: definition as unknown as Omit<WorkflowDefinition, "id">,
            correlationKey: crypto.randomUUID(),
          })
        );
        // The engine creates every workflow off; it comes in as it was in the source setup.
        if (enabled) {
          await runtime.call("setWorkflowEnabled", (api) =>
            api.setWorkflowEnabled(created.id, true, crypto.randomUUID())
          );
        }
        workflowIds.add(created.id);
        candidates.push({
          id: created.id,
          isEnabled: enabled,
          managed: false,
          definition: { ...definition, id: created.id } as unknown as WorkflowDefinition,
        });
        return { engineId: created.id };
      }
      const appended = {
        ...target.definition,
        id: target.id,
        tasks: appendSteps(
          target.definition.tasks as unknown as readonly Record<string, unknown>[],
          definition.tasks as unknown as readonly Record<string, unknown>[]
        ),
      } as unknown as WorkflowDefinition;
      const result = await runtime.call("updateWorkflow", (api) =>
        api.updateWorkflow(target.id, { definition: appended, correlationKey: crypto.randomUUID() })
      );
      if (result !== null && "conflict" in result) {
        throw new Error("The trigger changed while the item was installing. Try again.");
      }
      target.definition = appended;
      return { engineId: target.id };
    },
  };
}

export function directSetupImportsGateway(runtime: DirectRuntime): SetupImportsGateway {
  const read = uiSettingsRead(runtime, NAMESPACE);
  /** Imports being applied by this app now; a stored import that is applying and not here was cut off. */
  const applying = new Set<string>();

  const readAll = async () => readStored(runtime, await runtime.queryClient.fetchQuery({ ...read, staleTime: 0 }));

  const writeRun = (run: StoredRun) => storeUISetting(runtime, NAMESPACE, runKey(run.id), toSettingValue(run), MEMBER);

  const writeItem = (item: StoredItem) => {
    const { storeKey, ...value } = item;
    return storeUISetting(runtime, NAMESPACE, storeKey, toSettingValue(value), MEMBER);
  };

  const refreshAfterApply = () =>
    Promise.all(
      [
        k.commands.list(),
        k.commands.groups(),
        k.workflows.list(),
        k.workflows.health(),
        k.scenes.allAlertTargetUsage,
        k.moduleResources.all,
      ].map((queryKey) => runtime.queryClient.invalidateQueries({ queryKey }))
    );

  /** Creates the import's items not yet settled, in order, recording each one's outcome as it goes. */
  const applyRun = async (importId: string) => {
    const stored = await readAll();
    const run = stored.runs.find((candidate) => candidate.id === importId);
    if (run === undefined) {
      throw new Error("That import is gone.");
    }
    const items = stored.items.get(importId) ?? [];
    const earlierWorkflowIds = new Map<string, string[]>();
    for (const earlier of stored.runs) {
      if (earlier.id === importId || earlier.source !== run.source) {
        continue;
      }
      for (const item of stored.items.get(earlier.id) ?? []) {
        if (item.kind === "workflow" && item.outcome === "created" && item.engineId !== undefined) {
          earlierWorkflowIds.set(item.key, [...(earlierWorkflowIds.get(item.key) ?? []), item.engineId]);
        }
      }
    }

    const running = movedTo(run, "applying");
    await writeRun(running);
    const engine = await directImportEngine(runtime, run, earlierWorkflowIds);
    const applied = new Map<string, { outcome: ImportItemOutcome; engineId: string | null }>();
    for (const item of items) {
      if (item.outcome !== undefined && item.outcome !== "pending") {
        applied.set(item.key, { outcome: item.outcome, engineId: item.engineId ?? null });
      }
    }

    for (const item of items) {
      if (item.outcome !== undefined && item.outcome !== "pending") {
        continue;
      }
      let outcome: ImportOutcome;
      try {
        outcome = await applyImportItem(engine, applied, toStoredItem(item));
      } catch (error) {
        outcome = { outcome: "failed", message: errorMessage(error) };
      }
      applied.set(item.key, { outcome: outcome.outcome, engineId: outcome.engineId ?? null });
      await writeItem({ ...item, outcome: outcome.outcome, message: outcome.message, engineId: outcome.engineId });
    }
    await writeRun(movedTo(running, "done"));
    await refreshAfterApply();
  };

  /** Applies in the background: the screen follows the stored outcomes, and a failure that stops the run is shown on it. */
  const startApplying = (importId: string) => {
    if (applying.size > 0) {
      throw new Error("Another import is still being applied.");
    }
    applying.add(importId);
    void applyRun(importId)
      .catch((error: unknown) => {
        runtime.logger.error("DirectGateway: an import stopped before it finished", { importId, error });
      })
      .finally(() => {
        applying.delete(importId);
        return runtime.queryClient.invalidateQueries({ queryKey: k.uiSettings.namespace(NAMESPACE) });
      });
  };

  const findRun = async (id: SetupImportId) => {
    const importId = fromSetupImportId(id);
    const stored = await readAll();
    const run = stored.runs.find((candidate) => candidate.id === importId);
    return run === undefined ? null : { run, items: stored.items.get(importId) ?? [] };
  };

  const requireRun = async (id: SetupImportId) => {
    const found = await findRun(id);
    if (found === null) {
      throw new Error("Import not found");
    }
    return found;
  };

  const analyze = async ({ source, documentChunks }: SetupImportAnalysis) => {
    let planned: PlannedItem[];
    let label: string;
    let leftovers: StoredRun["leftovers"];
    try {
      const plan = convertDocument(source, documentChunks.join(""));
      planned = planItems(plan);
      label = plan.label;
      leftovers = plan.leftovers;
    } catch (error) {
      if (error instanceof ImportDocumentError) {
        throw new Error(error.message);
      }
      throw error;
    }
    const run: StoredRun = {
      id: runtime.newId(),
      source,
      label,
      status: "review",
      createdAt: runtime.clock.now(),
      leftovers,
    };
    for (const item of planned) {
      await writeItem({ ...item, storeKey: itemKey(run.id, item.order), importId: run.id });
    }
    await writeRun(run);
    return { importId: toSetupImportId(run.id) };
  };

  const start = async (id: SetupImportId) => {
    const { run } = await requireRun(id);
    if (run.status !== "review") {
      return;
    }
    startApplying(run.id);
  };

  const retry = async (id: SetupImportId) => {
    const { run, items } = await requireRun(id);
    if (applying.has(run.id)) {
      return;
    }
    if (run.status === "done") {
      for (const item of items) {
        if (item.outcome === "needs_module" || item.outcome === "failed") {
          await writeItem({ ...item, outcome: undefined, message: undefined });
        }
      }
    } else if (run.status === "review") {
      return;
    }
    startApplying(run.id);
  };

  const discard = async (id: SetupImportId) => {
    const found = await findRun(id);
    if (found === null) {
      return;
    }
    const { run, items } = found;
    if (applying.has(run.id)) {
      throw new Error("This import is still being applied.");
    }
    for (const item of items) {
      await removeUISetting(runtime, NAMESPACE, item.storeKey, MEMBER);
    }
    await removeUISetting(runtime, NAMESPACE, runKey(run.id), MEMBER);
  };

  const useLatest = () => {
    const settings = useEngineQuery(runtime, read);
    return useMemo(() => {
      if (settings === undefined) {
        return undefined;
      }
      const stored = readStored(runtime, settings);
      const run = latestRun(stored.runs);
      return run === null ? null : toReport(run, stored.items.get(run.id) ?? [], applying.has(run.id));
    }, [runtime, settings]);
  };

  return {
    useLatest,
    useAnalyzeRequest: () => useEngineRequest(analyze),
    useStartRequest: () => useEngineRequest(start),
    useRetryRequest: () => useEngineRequest(retry),
    useDiscardRequest: () => useEngineRequest(discard),
  };
}
