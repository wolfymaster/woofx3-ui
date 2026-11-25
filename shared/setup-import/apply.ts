import { unescapeDollarKeys } from "@shared/dollar-keys";
import type { StarterCatalog } from "@shared/starter-packs";
import type { CounterIds, ImportWorkflowDefinition } from "./compile";
import { compileCommandActions, compileWorkflow, missingRequirementMessage } from "./compile";
import type {
  ImportCommandSpec,
  ImportCounterSpec,
  ImportGroupSpec,
  ImportItem,
  ImportItemKind,
  ImportReadiness,
  ImportSource,
  ImportWorkflowSpec,
} from "./types";

export type ImportItemOutcome = "created" | "exists" | "needs_module" | "skipped" | "pending" | "failed";

export interface ImportOutcome {
  outcome: ImportItemOutcome;
  message?: string;
  engineId?: string;
}

/** Outcome and engine id of every item applied so far, by item key. */
export type AppliedItems = ReadonlyMap<string, { outcome: ImportItemOutcome; engineId: string | null }>;

/** An item as an import's store keeps it: the plan's item with its `$` keys escaped, and the store's own handle for it. */
export interface StoredImportItem {
  /** The store's handle for the item, which `ImportEngine.placeWorkflow` hands back to the store. */
  ref: string;
  key: string;
  kind: ImportItemKind;
  name: string;
  origin: string;
  notes: ImportItem["notes"];
  readiness: ImportReadiness;
  spec: unknown;
}

export interface ImportedCommand {
  command: string;
  actions: ReturnType<typeof compileCommandActions>;
  cooldown: number;
  enabled: boolean;
  visibility: "public" | "restricted";
  groupIds: string[];
  usernames: string[];
}

/**
 * What applying an import needs of the engine and of whatever remembers what
 * earlier imports made. The hosted app answers it through Convex and the
 * desktop app's local mode straight from the engine, so the rules of an import
 * (what exists, what is skipped, what a command is limited to) live here once.
 */
export interface ImportEngine {
  source: ImportSource;
  catalog: StarterCatalog;
  /** The group, counter or command the item would collide with or reuse; for a workflow, the one an earlier import of the same file made. */
  findExisting(kind: ImportItemKind, item: StoredImportItem, name: string): Promise<{ engineId: string } | null>;
  /** The module that declares the counter kind; null when no installed module does. */
  counterModule(): Promise<string | null>;
  createCounter(moduleName: string, spec: ImportCounterSpec): Promise<string>;
  /** Engine ids of the built-in groups named; a name the engine has not reported is left out. */
  builtInGroupIds(names: readonly string[]): Promise<Record<string, string>>;
  createGroup(group: { name: string; description?: string }): Promise<string>;
  addGroupMember(engineGroupId: string, username: string): Promise<void>;
  createCommand(command: ImportedCommand): Promise<string>;
  /**
   * Extends the workflow already on this trigger or creates a new one. `pending`
   * when the engine has not confirmed it yet; a later look settles it.
   */
  placeWorkflow(
    item: StoredImportItem,
    definition: ImportWorkflowDefinition,
    enabled: boolean
  ): Promise<{ engineId: string } | "pending">;
}

function blockingMessage(item: StoredImportItem): string {
  return item.notes.find((note) => note.blocking === true)?.message ?? "woofx3 cannot run it yet.";
}

/** Canonical ids of the counters this import created or found, by item key. */
function counterIds(applied: AppliedItems): CounterIds {
  const ids = new Map<string, string>();
  for (const [key, entry] of applied) {
    if ((entry.outcome === "created" || entry.outcome === "exists") && entry.engineId !== null) {
      ids.set(key, entry.engineId);
    }
  }
  return ids;
}

/** A key's engine id when its item went in, created now or found already there. */
function usableId(applied: AppliedItems, key: string): string | null {
  const entry = applied.get(key);
  if (!entry || (entry.outcome !== "created" && entry.outcome !== "exists")) {
    return null;
  }
  return entry.engineId;
}

async function applyGroup(engine: ImportEngine, item: StoredImportItem, spec: ImportGroupSpec): Promise<ImportOutcome> {
  const found = await engine.findExisting("group", item, spec.name);
  // stylegate:ignore ANY-CON-005 reason="one loop applies an import item by item, and a second import is never applied beside it (a claim in Convex, one applying import in local mode); the engine also keeps group names unique"
  if (found) {
    return {
      outcome: "exists",
      engineId: found.engineId,
      message: `You already have a group called ${spec.name}; imported commands use it and its members are left as they are.`,
    };
  }
  const engineId = await engine.createGroup({ name: spec.name, description: spec.description });
  const failedMembers: string[] = [];
  for (const member of spec.members) {
    try {
      await engine.addGroupMember(engineId, member);
    } catch {
      failedMembers.push(member);
    }
  }
  return {
    outcome: "created",
    engineId,
    message:
      failedMembers.length > 0
        ? `Could not add ${failedMembers.join(", ")} to it; add them on the Groups page.`
        : undefined,
  };
}

async function applyCounter(
  engine: ImportEngine,
  item: StoredImportItem,
  spec: ImportCounterSpec
): Promise<ImportOutcome> {
  const found = await engine.findExisting("counter", item, spec.resourceInstanceId);
  // stylegate:ignore ANY-CON-005 reason="one loop applies an import item by item, and a second import is never applied beside it (a claim in Convex, one applying import in local mode); a counter made by hand between the check and the create is not guarded, as in its own editor"
  if (found) {
    return {
      outcome: "exists",
      engineId: found.engineId,
      message: `You already have a counter "${spec.resourceInstanceId}"; imported steps use it.`,
    };
  }
  const moduleName = await engine.counterModule();
  if (moduleName === null) {
    return { outcome: "needs_module", message: "Needs a newer woofx3." };
  }
  return { outcome: "created", engineId: await engine.createCounter(moduleName, spec) };
}

async function applyCommand(
  engine: ImportEngine,
  applied: AppliedItems,
  item: StoredImportItem,
  spec: ImportCommandSpec,
  imported: ImportItem
): Promise<ImportOutcome> {
  const missing = missingRequirementMessage(imported, engine.catalog);
  if (missing) {
    return { outcome: "needs_module", message: missing };
  }
  // stylegate:ignore ANY-CON-005 reason="one loop applies an import item by item, and a second import is never applied beside it (a claim in Convex, one applying import in local mode); a command made by hand between the check and the create is not guarded, as in the command editor"
  if (await engine.findExisting("command", item, spec.command)) {
    return { outcome: "exists", message: `You already have !${spec.command}; yours is kept.` };
  }

  const groupIds: string[] = [];
  if (spec.access.builtIn.length > 0) {
    const ids = await engine.builtInGroupIds(spec.access.builtIn);
    for (const name of spec.access.builtIn) {
      const id = ids[name];
      if (id === undefined) {
        return {
          outcome: "failed",
          message: `The ${name} group has not synced from the engine yet. Try again shortly.`,
        };
      }
      groupIds.push(id);
    }
  }
  for (const key of spec.access.groupKeys) {
    const id = usableId(applied, key);
    if (id === null) {
      // Leaving the group out would open the command to more people than before.
      return { outcome: "skipped", message: "A group it is limited to was not imported, so it was left out." };
    }
    groupIds.push(id);
  }

  const restricted = groupIds.length > 0 || spec.access.usernames.length > 0;
  const engineId = await engine.createCommand({
    command: spec.command,
    actions: compileCommandActions(spec.steps, engine.catalog, counterIds(applied)),
    cooldown: spec.cooldown,
    enabled: spec.enabled,
    visibility: restricted ? "restricted" : "public",
    groupIds,
    usernames: spec.access.usernames,
  });
  return { outcome: "created", engineId };
}

async function applyWorkflow(
  engine: ImportEngine,
  applied: AppliedItems,
  item: StoredImportItem,
  spec: ImportWorkflowSpec,
  imported: ImportItem
): Promise<ImportOutcome> {
  if (spec.commandKey !== undefined && applied.get(spec.commandKey)?.outcome !== "created") {
    return { outcome: "skipped", message: "Its chat command was not created, so this part of it was left out too." };
  }
  const missing = missingRequirementMessage(imported, engine.catalog);
  if (missing) {
    return { outcome: "needs_module", message: missing };
  }
  const found = await engine.findExisting("workflow", item, spec.name);
  // stylegate:ignore ANY-CON-005 reason="one loop applies an import item by item, and a second import is never applied beside it (a claim in Convex, one applying import in local mode); a workflow made by hand between the check and the create is not guarded, as in its own editor"
  if (found) {
    return { outcome: "exists", engineId: found.engineId, message: "An earlier import already created it." };
  }
  const placed = await engine.placeWorkflow(
    item,
    compileWorkflow(spec, engine.catalog, counterIds(applied)),
    spec.enabled
  );
  if (placed === "pending") {
    return { outcome: "pending", message: "Not confirmed yet. It shows as imported once it is." };
  }
  return { outcome: "created", engineId: placed.engineId };
}

/**
 * Creates one item on the engine. `applied` holds the outcome of every item
 * before it, which commands and workflows read to find the groups and counters
 * they use. Throws when the engine refuses; the caller records that as the
 * item's failure.
 */
export async function applyImportItem(
  engine: ImportEngine,
  applied: AppliedItems,
  item: StoredImportItem
): Promise<ImportOutcome> {
  if (item.readiness === "unsupported") {
    return { outcome: "skipped", message: blockingMessage(item) };
  }
  const imported = {
    key: item.key,
    name: item.name,
    origin: item.origin,
    notes: item.notes,
    kind: item.kind,
    spec: unescapeDollarKeys(item.spec),
  } as ImportItem;
  switch (imported.kind) {
    case "group":
      return applyGroup(engine, item, imported.spec);
    case "counter":
      return applyCounter(engine, item, imported.spec);
    case "command":
      return applyCommand(engine, applied, item, imported.spec, imported);
    case "workflow":
      return applyWorkflow(engine, applied, item, imported.spec, imported);
  }
}
