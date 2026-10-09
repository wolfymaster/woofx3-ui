import type { WorkflowDefinition } from "@woofx3/api";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { addGroupMemberInEngine, createCommandInEngine, createGroupInEngine } from "./chatCommandActions";
import { escapeDollarKeys, unescapeDollarKeys } from "./lib/dollarKeys";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceRole, requireInstanceRoleInAction } from "./lib/instanceAccess";
import { COUNTER_KIND } from "./lib/resourceKinds";
import { flattenSteps } from "./lib/setupImport/build";
import { compileCommandActions, compileWorkflow, missingRequirementMessage } from "./lib/setupImport/compile";
import { convertFirebot } from "./lib/setupImport/firebot";
import { asRecord, asString } from "./lib/setupImport/read";
import { convertStreamerbot } from "./lib/setupImport/streamerbot";
import {
  IMPORT_KIND_ORDER,
  type ImportCommandSpec,
  type ImportCounterSpec,
  type ImportGroupSpec,
  type ImportItem,
  type ImportPlan,
  type ImportWorkflowSpec,
  itemReadiness,
} from "./lib/setupImport/types";
import type { StarterCatalog } from "./lib/starterPacks";
import { isInstanceMember } from "./lib/teamAccess";
import { findResourceKind } from "./resourceKinds";
import { starterCatalog } from "./starterPacks";
import {
  createWorkflowInEngine,
  EngineConfirmationTimeout,
  type InstanceContext,
  setWorkflowEnabledInEngine,
} from "./workflowActions";
import type { CatalogBundle } from "./workflowCatalogContext";

/**
 * Bringing a streamer's setup over from Firebot or Streamer.bot.
 *
 * `analyze` converts the export (opened in the browser by
 * lib/setupImport/decode.ts) and stores the result for review. `start` queues
 * it, and `apply` creates each item through the same functions the workflow
 * builder, command editor, groups page and counters page use, so the engine
 * sees ordinary user-made objects. Applying runs in the background in slices,
 * reporting per item, so an import of hundreds of items survives action time
 * limits and the report fills in as it goes.
 */

const sourceValidator = v.union(v.literal("firebot"), v.literal("streamerbot"));

/** More than any real setup has; keeps one import inside a few mutations' write limits. */
const MAX_IMPORT_ITEMS = 2000;
const INSERT_BATCH = 100;

/** An apply that has not reported back within this long is taken to have died. */
const APPLY_CLAIM_TTL_MS = 10 * 60_000;
/** How much of an action's time one apply slice uses before handing on to the next. */
const APPLY_SLICE_MS = 4 * 60_000;
/** How often a queued import checks whether setup has finished installing modules. */
const SETUP_POLL_MS = 15_000;
/**
 * How long an import waits for setup's module installs, or for the engine to
 * register, before applying anyway and reporting what is missing.
 */
const SETUP_WAIT_LIMIT_MS = 30 * 60_000;

export type ImportItemOutcome = NonNullable<Doc<"setupImportItems">["outcome"]>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stepLabels(item: ImportItem): string[] {
  if (item.kind === "command") {
    return item.spec.steps.map((step) => step.label);
  }
  if (item.kind === "workflow") {
    return flattenSteps(item.spec.steps).map((step) => step.label);
  }
  return [];
}

function convertDocument(source: "firebot" | "streamerbot", text: string): ImportPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConvexError("The import could not be read. Choose the file again.");
  }
  const document = asRecord(parsed);
  if (!document) {
    throw new ConvexError("The import could not be read. Choose the file again.");
  }
  const name = asString(document.name);
  if (source === "firebot") {
    const components = asRecord(document.components);
    if (!components) {
      throw new ConvexError("This is not a Firebot setup.");
    }
    return convertFirebot({ name, components });
  }
  const exported = asRecord(document.export);
  if (!exported) {
    throw new ConvexError("This is not a Streamer.bot export.");
  }
  return convertStreamerbot({ name, export: exported });
}

/**
 * Convert an opened export and keep it for review. Nothing reaches the engine
 * until `start`. The document arrives in chunks because Convex caps a single
 * string argument at 1 MiB.
 */
export const analyze = action({
  args: {
    instanceId: v.id("instances"),
    source: sourceValidator,
    documentChunks: v.array(v.string()),
  },
  handler: async (ctx, { instanceId, source, documentChunks }): Promise<{ importId: Id<"setupImports"> }> => {
    const userId = await requireInstanceRoleInAction(ctx, instanceId, "admin");
    const plan = convertDocument(source, documentChunks.join(""));
    if (plan.items.length > MAX_IMPORT_ITEMS) {
      throw new ConvexError(`This setup has ${plan.items.length} items; an import takes at most ${MAX_IMPORT_ITEMS}.`);
    }
    const order = (item: ImportItem) => IMPORT_KIND_ORDER.indexOf(item.kind);
    const items = plan.items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => order(a.item) - order(b.item) || a.index - b.index)
      .map(({ item }, index) => ({
        order: index,
        key: item.key,
        kind: item.kind,
        name: item.name,
        origin: item.origin,
        readiness: itemReadiness(item),
        notes: item.notes,
        steps: stepLabels(item),
        spec: escapeDollarKeys(item.spec),
      }));

    const importId: Id<"setupImports"> = await ctx.runMutation(internal.setupImports.createRun, {
      instanceId,
      source,
      label: plan.label,
      createdByUserId: userId,
      leftovers: plan.leftovers,
    });
    for (let start = 0; start < items.length; start += INSERT_BATCH) {
      await ctx.runMutation(internal.setupImports.insertItems, {
        importId,
        items: items.slice(start, start + INSERT_BATCH),
      });
    }
    return { importId };
  },
});

export const createRun = internalMutation({
  args: {
    instanceId: v.id("instances"),
    source: sourceValidator,
    label: v.string(),
    createdByUserId: v.id("users"),
    leftovers: v.array(
      v.object({ origin: v.string(), name: v.string(), message: v.string(), detail: v.optional(v.string()) })
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("setupImports", { ...args, createdAt: Date.now(), status: "review" });
  },
});

export const insertItems = internalMutation({
  args: {
    importId: v.id("setupImports"),
    items: v.array(
      v.object({
        order: v.number(),
        key: v.string(),
        kind: v.union(v.literal("group"), v.literal("counter"), v.literal("command"), v.literal("workflow")),
        name: v.string(),
        origin: v.string(),
        readiness: v.union(v.literal("ready"), v.literal("partial"), v.literal("unsupported")),
        notes: v.array(
          v.object({ message: v.string(), detail: v.optional(v.string()), blocking: v.optional(v.boolean()) })
        ),
        steps: v.array(v.string()),
        spec: v.any(),
      })
    ),
  },
  handler: async (ctx, { importId, items }) => {
    const run = await ctx.db.get(importId);
    if (!run) {
      throw new Error("Import not found");
    }
    for (const item of items) {
      await ctx.db.insert("setupImportItems", { ...item, importId, instanceId: run.instanceId, source: run.source });
    }
  },
});

async function readItems(ctx: QueryCtx, importId: Id<"setupImports">): Promise<Doc<"setupImportItems">[]> {
  return await ctx.db
    .query("setupImportItems")
    .withIndex("by_import", (q) => q.eq("importId", importId))
    .take(MAX_IMPORT_ITEMS);
}

export interface ImportReportItem {
  id: Id<"setupImportItems">;
  kind: Doc<"setupImportItems">["kind"];
  name: string;
  origin: string;
  readiness: Doc<"setupImportItems">["readiness"];
  notes: Doc<"setupImportItems">["notes"];
  steps: string[];
  outcome: ImportItemOutcome | null;
  message: string | null;
}

export interface ImportReport {
  id: Id<"setupImports">;
  source: Doc<"setupImports">["source"];
  label: string;
  status: Doc<"setupImports">["status"];
  createdAt: number;
  waitingFor: string | null;
  /** Gave up waiting on something outside the import; Try again starts it once that is fixed. */
  stalled: boolean;
  leftovers: Doc<"setupImports">["leftovers"];
  items: ImportReportItem[];
}

function toReport(run: Doc<"setupImports">, items: Doc<"setupImportItems">[]): ImportReport {
  return {
    id: run._id,
    source: run.source,
    label: run.label,
    status: run.status,
    createdAt: run.createdAt,
    waitingFor: run.waitingFor ?? null,
    stalled: run.stalled === true,
    leftovers: run.leftovers,
    items: items.map((item) => ({
      id: item._id,
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

/** One import and how each of its items stands. Null for anyone not a member of its instance. */
export const get = query({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }): Promise<ImportReport | null> => {
    const run = await ctx.db.get(importId);
    if (!run || !(await isInstanceMember(ctx, run.instanceId))) {
      return null;
    }
    return toReport(run, await readItems(ctx, importId));
  },
});

/** The instance's most recent import, so a page opened later picks up where it was left. */
export const latest = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ImportReport | null> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    const run = await ctx.db
      .query("setupImports")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .first();
    return run ? toReport(run, await readItems(ctx, run._id)) : null;
  },
});

/** Create the reviewed import's items. Safe to call twice: an import already queued stays queued. */
export const start = mutation({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }) => {
    const run = await ctx.db.get(importId);
    if (!run) {
      throw new ConvexError("Import not found");
    }
    await requireInstanceRole(ctx, run.instanceId, "admin");
    if (run.status !== "review") {
      return;
    }
    await ctx.db.patch(importId, { status: "queued", queuedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.setupImports.apply, { importId });
  },
});

/**
 * Try again the items that did not go in: those that needed a module since
 * installed, and those that failed. Items already created are left alone.
 */
export const retry = mutation({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }) => {
    const run = await ctx.db.get(importId);
    if (!run) {
      throw new ConvexError("Import not found");
    }
    await requireInstanceRole(ctx, run.instanceId, "admin");
    if (run.status === "queued" && run.stalled === true) {
      await ctx.db.patch(importId, { queuedAt: Date.now(), stalled: false });
      await ctx.scheduler.runAfter(0, internal.setupImports.apply, { importId });
      return;
    }
    if (run.status !== "done") {
      return;
    }
    for (const item of await readItems(ctx, importId)) {
      if (item.outcome === "needs_module" || item.outcome === "failed") {
        await ctx.db.patch(item._id, { outcome: undefined, message: undefined });
      }
    }
    await ctx.db.patch(importId, { status: "queued", queuedAt: Date.now(), finishedAt: undefined });
    await ctx.scheduler.runAfter(0, internal.setupImports.apply, { importId });
  },
});

/** Throw away an import still under review, so another file can be chosen. */
export const discard = mutation({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }) => {
    const run = await ctx.db.get(importId);
    if (!run) {
      return;
    }
    await requireInstanceRole(ctx, run.instanceId, "admin");
    if (run.status !== "review" && run.status !== "done") {
      throw new ConvexError("This import is still being applied.");
    }
    for (const item of await readItems(ctx, importId)) {
      await ctx.db.delete(item._id);
    }
    await ctx.db.delete(importId);
  },
});

type Claim = { state: "claimed"; instanceId: Id<"instances">; queuedAt: number } | { state: "skip" };

export const claimRun = internalMutation({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }): Promise<Claim> => {
    const run = await ctx.db.get(importId);
    if (!run || (run.status !== "queued" && run.status !== "applying")) {
      return { state: "skip" };
    }
    const now = Date.now();
    if (run.claimedAt !== undefined && now - run.claimedAt < APPLY_CLAIM_TTL_MS) {
      return { state: "skip" };
    }
    await ctx.db.patch(importId, { claimedAt: now });
    return { state: "claimed", instanceId: run.instanceId, queuedAt: run.queuedAt ?? now };
  },
});

export const releaseRun = internalMutation({
  args: {
    importId: v.id("setupImports"),
    status: v.union(v.literal("queued"), v.literal("applying"), v.literal("done")),
    waitingFor: v.optional(v.string()),
    stalled: v.optional(v.boolean()),
  },
  handler: async (ctx, { importId, status, waitingFor, stalled }) => {
    if (!(await ctx.db.get(importId))) {
      return;
    }
    await ctx.db.patch(importId, {
      status,
      waitingFor,
      stalled,
      claimedAt: undefined,
      finishedAt: status === "done" ? Date.now() : undefined,
    });
  },
});

/** Mark a claimed import as applying; the claim stays held. */
export const beginApplying = internalMutation({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }) => {
    await ctx.db.patch(importId, { status: "applying", waitingFor: undefined });
  },
});

/** Why an import cannot apply yet. `since` is when the wait began, for waits that may time out. */
export type SetupBlocker = { message: string; since: number } | { message: string; since: null };

/**
 * Why an instance in the middle of setup is not ready for an import yet, or
 * null when it is. Setup installs the platform modules an import's triggers
 * and actions come from, and starter packs wait for their triggers to sync;
 * an import made during setup waits for the same. Waiting for the streamer to
 * finish setup has no end, so `since` is null and the import is resumed by
 * `setup.complete` rather than polled.
 */
export const setupBlocker = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<SetupBlocker | null> => {
    const setup = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (!setup) {
      return null;
    }
    if (setup.completedAt === undefined) {
      return { message: "Starts once you finish setup.", since: null };
    }
    if (setup.moduleInstalls === undefined || (setup.packInstalls ?? []).some((pack) => pack.status === "pending")) {
      return { message: "Waiting for your platforms to finish installing.", since: setup.completedAt };
    }
    return null;
  },
});

/** Apply the instance's queued imports; scheduled when setup finishes. */
export const resumeQueued = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const runs = await ctx.db
      .query("setupImports")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .take(20);
    for (const run of runs) {
      if (run.status === "queued") {
        // Its wait for the engine starts now, not when it was queued mid-setup.
        await ctx.db.patch(run._id, { queuedAt: Date.now(), stalled: false });
        await ctx.scheduler.runAfter(0, internal.setupImports.apply, { importId: run._id });
      }
    }
  },
});

export const pendingItems = internalQuery({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }) => {
    const items = await readItems(ctx, importId);
    return items.filter((item) => item.outcome === undefined || item.outcome === "pending");
  },
});

/** Engine ids this import's earlier items became, by item key: what later items refer to. */
export const createdIds = internalQuery({
  args: { importId: v.id("setupImports") },
  handler: async (
    ctx,
    { importId }
  ): Promise<Record<string, { outcome: ImportItemOutcome; engineId: string | null }>> => {
    const ids: Record<string, { outcome: ImportItemOutcome; engineId: string | null }> = {};
    for (const item of await readItems(ctx, importId)) {
      if (item.outcome !== undefined) {
        ids[item.key] = { outcome: item.outcome, engineId: item.engineId ?? null };
      }
    }
    return ids;
  },
});

export const recordOutcome = internalMutation({
  args: {
    itemId: v.id("setupImportItems"),
    outcome: v.union(
      v.literal("created"),
      v.literal("exists"),
      v.literal("needs_module"),
      v.literal("skipped"),
      v.literal("pending"),
      v.literal("failed")
    ),
    message: v.optional(v.string()),
    engineId: v.optional(v.string()),
  },
  handler: async (ctx, { itemId, outcome, message, engineId }) => {
    const item = await ctx.db.get(itemId);
    if (!item) {
      return;
    }
    // A late echo may already have marked it created.
    if (outcome === "pending" && item.outcome === "created") {
      return;
    }
    await ctx.db.patch(itemId, { outcome, message, engineId: engineId ?? item.engineId });
  },
});

export const setCorrelation = internalMutation({
  args: { itemId: v.id("setupImportItems"), correlationKey: v.string() },
  handler: async (ctx, { itemId, correlationKey }) => {
    await ctx.db.patch(itemId, { correlationKey });
  },
});

/** What already exists on the instance that an item could collide with or reuse. */
export const existing = internalQuery({
  args: {
    instanceId: v.id("instances"),
    source: sourceValidator,
    key: v.string(),
    kind: v.union(v.literal("group"), v.literal("counter"), v.literal("command"), v.literal("workflow")),
    name: v.string(),
  },
  handler: async (ctx, { instanceId, source, key, kind, name }) => {
    const lower = name.toLowerCase();
    if (kind === "group") {
      const groups = await ctx.db
        .query("chatCommandGroups")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .take(500);
      const group = groups.find((candidate) => candidate.name.toLowerCase() === lower);
      return group ? { engineId: group.engineGroupId } : null;
    }
    if (kind === "counter") {
      const counters = await ctx.db
        .query("moduleResourceInstances")
        .withIndex("by_instance_kind", (q) => q.eq("instanceId", instanceId).eq("kind", "counter"))
        .take(500);
      const counter = counters.find((candidate) => candidate.resourceInstanceId === name);
      return counter ? { engineId: counter.canonicalId } : null;
    }
    if (kind === "command") {
      const commands = await ctx.db
        .query("chatCommands")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .take(500);
      const command = commands.find((candidate) => candidate.command.toLowerCase() === lower);
      return command ? { engineId: command.engineCommandId } : null;
    }
    // A workflow has no unique name; it is the same one only when an earlier
    // import of the same file created it and it still exists.
    const earlier = await ctx.db
      .query("setupImportItems")
      .withIndex("by_instance_key", (q) => q.eq("instanceId", instanceId).eq("source", source).eq("key", key))
      .take(50);
    for (const item of earlier) {
      if (item.outcome !== "created" || item.engineId === undefined) {
        continue;
      }
      const engineId = item.engineId;
      const workflow = await ctx.db
        .query("workflows")
        .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineId))
        .first();
      if (workflow) {
        return { engineId };
      }
    }
    return null;
  },
});

export const counterKind = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const kind = await findResourceKind(ctx, instanceId, COUNTER_KIND);
    return kind ? { moduleName: kind.moduleName } : null;
  },
});

export const completion = internalQuery({
  args: { correlationKey: v.string() },
  handler: async (ctx, { correlationKey }) => {
    const row = await ctx.db
      .query("completedWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
    return row ? row.engineWorkflowId : null;
  },
});

type Outcome = { outcome: ImportItemOutcome; message?: string; engineId?: string };

interface ApplyContext {
  ctx: ActionCtx;
  instanceId: Id<"instances">;
  importId: Id<"setupImports">;
  source: "firebot" | "streamerbot";
  instance: InstanceContext;
  catalog: StarterCatalog;
  /** Outcome and engine id of every item applied so far, by key. */
  done: Map<string, { outcome: ImportItemOutcome; engineId: string | null }>;
}

function blockingMessage(item: Doc<"setupImportItems">): string {
  return item.notes.find((note) => note.blocking === true)?.message ?? "woofx3 cannot run it yet.";
}

/** Canonical ids of the counters this import created or found, by item key. */
function counterIds(apply: ApplyContext): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [key, entry] of apply.done) {
    if ((entry.outcome === "created" || entry.outcome === "exists") && entry.engineId !== null) {
      ids.set(key, entry.engineId);
    }
  }
  return ids;
}

/** A key's engine id when its item went in, created now or found already there. */
function usableId(apply: ApplyContext, key: string): string | null {
  const entry = apply.done.get(key);
  if (!entry || (entry.outcome !== "created" && entry.outcome !== "exists")) {
    return null;
  }
  return entry.engineId;
}

async function applyGroup(apply: ApplyContext, item: Doc<"setupImportItems">, spec: ImportGroupSpec): Promise<Outcome> {
  const { ctx, instanceId, instance } = apply;
  const found = await ctx.runQuery(internal.setupImports.existing, {
    instanceId,
    source: apply.source,
    key: item.key,
    kind: "group",
    name: spec.name,
  });
  if (found) {
    return {
      outcome: "exists",
      engineId: found.engineId,
      message: `You already have a group called ${spec.name}; imported commands use it and its members are left as they are.`,
    };
  }
  const engineId = await createGroupInEngine(ctx, instanceId, instance, {
    name: spec.name,
    description: spec.description,
  });
  const failedMembers: string[] = [];
  for (const member of spec.members) {
    try {
      await addGroupMemberInEngine(ctx, instanceId, instance, engineId, member);
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
  apply: ApplyContext,
  item: Doc<"setupImportItems">,
  spec: ImportCounterSpec
): Promise<Outcome> {
  const { ctx, instanceId, instance } = apply;
  const found = await ctx.runQuery(internal.setupImports.existing, {
    instanceId,
    source: apply.source,
    key: item.key,
    kind: "counter",
    name: spec.resourceInstanceId,
  });
  if (found) {
    return {
      outcome: "exists",
      engineId: found.engineId,
      message: `You already have a counter "${spec.resourceInstanceId}"; imported steps use it.`,
    };
  }
  const kind = await ctx.runQuery(internal.setupImports.counterKind, { instanceId });
  if (!kind) {
    return { outcome: "needs_module", message: "Needs a newer engine." };
  }
  const result = await createEngineRpcSession<EngineApi>(
    instance.url,
    instance.clientId,
    instance.clientSecret
  ).createResourceInstance(kind.moduleName, "counter", spec.resourceInstanceId, spec.displayName, {
    lifetime: "forever",
    initialValue: spec.initialValue,
    step: 1,
  });
  return { outcome: "created", engineId: result.canonicalId };
}

async function applyCommand(
  apply: ApplyContext,
  item: Doc<"setupImportItems">,
  spec: ImportCommandSpec,
  imported: ImportItem
): Promise<Outcome> {
  const { ctx, instanceId, instance, catalog } = apply;
  const missing = missingRequirementMessage(imported, catalog);
  if (missing) {
    return { outcome: "needs_module", message: missing };
  }
  const found = await ctx.runQuery(internal.setupImports.existing, {
    instanceId,
    source: apply.source,
    key: item.key,
    kind: "command",
    name: spec.command,
  });
  if (found) {
    return { outcome: "exists", message: `You already have !${spec.command}; yours is kept.` };
  }

  const groupIds: string[] = [];
  if (spec.access.builtIn.length > 0) {
    const ids: Record<string, string> = await ctx.runQuery(internal.starterPacks.builtInGroupIds, {
      instanceId,
      names: spec.access.builtIn,
    });
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
    const id = usableId(apply, key);
    if (id === null) {
      // Leaving the group out would open the command to more people than before.
      return { outcome: "skipped", message: "A group it is limited to was not imported, so it was left out." };
    }
    groupIds.push(id);
  }

  const restricted = groupIds.length > 0 || spec.access.usernames.length > 0;
  const engineId = await createCommandInEngine(ctx, instanceId, instance, {
    command: spec.command,
    actions: compileCommandActions(spec.steps, catalog, counterIds(apply)),
    cooldown: spec.cooldown,
    enabled: spec.enabled,
    visibility: restricted ? "restricted" : "public",
    groupIds,
    usernames: spec.access.usernames,
  });
  return { outcome: "created", engineId };
}

async function applyWorkflow(
  apply: ApplyContext,
  item: Doc<"setupImportItems">,
  spec: ImportWorkflowSpec,
  imported: ImportItem
): Promise<Outcome> {
  const { ctx, instanceId, instance, catalog } = apply;
  if (spec.commandKey !== undefined) {
    const command = apply.done.get(spec.commandKey);
    if (command?.outcome !== "created") {
      return {
        outcome: "skipped",
        message: "Its chat command was not created, so this part of it was left out too.",
      };
    }
  }
  const missing = missingRequirementMessage(imported, catalog);
  if (missing) {
    return { outcome: "needs_module", message: missing };
  }
  const found = await ctx.runQuery(internal.setupImports.existing, {
    instanceId,
    source: apply.source,
    key: item.key,
    kind: "workflow",
    name: spec.name,
  });
  if (found) {
    return { outcome: "exists", engineId: found.engineId, message: "An earlier import already created it." };
  }

  const definition = compileWorkflow(spec, catalog, counterIds(apply));
  const correlationKey = crypto.randomUUID();
  await ctx.runMutation(internal.setupImports.setCorrelation, { itemId: item._id, correlationKey });
  let engineId: string;
  try {
    engineId = await createWorkflowInEngine(
      ctx,
      instanceId,
      instance,
      // Carries delay waits and `$ref`s, which the shared WorkflowDefinition type does not model.
      definition as unknown as Omit<WorkflowDefinition, "id">,
      correlationKey
    );
  } catch (err) {
    if (err instanceof EngineConfirmationTimeout) {
      return { outcome: "pending", message: "The engine has not confirmed it yet; it shows as imported once it does." };
    }
    throw err;
  }
  if (!spec.enabled) {
    // The workflow exists from here on, so failing to turn it off must not
    // report it as failed: a retry would create it a second time.
    try {
      await setWorkflowEnabledInEngine(ctx, instanceId, instance, engineId, false);
    } catch {
      return {
        outcome: "created",
        engineId,
        message: "It was off in your old setup, but could not be turned off here; turn it off on the Workflows page.",
      };
    }
  }
  return { outcome: "created", engineId };
}

async function applyItem(apply: ApplyContext, item: Doc<"setupImportItems">): Promise<Outcome> {
  if (item.outcome === "pending" && item.correlationKey !== undefined) {
    const engineId = await apply.ctx.runQuery(internal.setupImports.completion, {
      correlationKey: item.correlationKey,
    });
    return engineId === null ? { outcome: "pending", message: item.message } : { outcome: "created", engineId };
  }
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
      return applyGroup(apply, item, imported.spec);
    case "counter":
      return applyCounter(apply, item, imported.spec);
    case "command":
      return applyCommand(apply, item, imported.spec, imported);
    case "workflow":
      return applyWorkflow(apply, item, imported.spec, imported);
  }
}

/**
 * Create an import's items, in order, until they are all done or this slice's
 * time is up, then hand on to the next slice. Items are created through the
 * same functions the UI uses for each kind.
 */
export const apply = internalAction({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }) => {
    const claim: Claim = await ctx.runMutation(internal.setupImports.claimRun, { importId });
    if (claim.state !== "claimed") {
      return;
    }
    const { instanceId } = claim;

    const blocker: SetupBlocker | null = await ctx.runQuery(internal.setupImports.setupBlocker, { instanceId });
    if (blocker !== null) {
      if (blocker.since === null) {
        await ctx.runMutation(internal.setupImports.releaseRun, {
          importId,
          status: "queued",
          waitingFor: blocker.message,
        });
        return;
      }
      if (Date.now() - blocker.since < SETUP_WAIT_LIMIT_MS) {
        await ctx.runMutation(internal.setupImports.releaseRun, {
          importId,
          status: "queued",
          waitingFor: blocker.message,
        });
        await ctx.scheduler.runAfter(SETUP_POLL_MS, internal.setupImports.apply, { importId });
        return;
      }
    }

    const run: ImportReport | null = await ctx.runQuery(internal.setupImports.runForApply, { importId });
    const bundle: CatalogBundle | null = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForInstance, {
      instanceId,
    });
    if (!run) {
      return;
    }
    if (!bundle?.clientId || !bundle.clientSecret) {
      const stillWaiting = Date.now() - claim.queuedAt < SETUP_WAIT_LIMIT_MS;
      await ctx.runMutation(internal.setupImports.releaseRun, {
        importId,
        status: "queued",
        waitingFor: stillWaiting
          ? "Waiting for your engine to finish registering."
          : "Your engine has not registered yet. Finish connecting it, then choose Try again.",
        stalled: !stillWaiting,
      });
      if (stillWaiting) {
        await ctx.scheduler.runAfter(SETUP_POLL_MS, internal.setupImports.apply, { importId });
      }
      return;
    }
    await ctx.runMutation(internal.setupImports.beginApplying, { importId });

    const done = new Map(Object.entries(await ctx.runQuery(internal.setupImports.createdIds, { importId })));
    const apply: ApplyContext = {
      ctx,
      instanceId,
      importId,
      source: run.source,
      instance: { url: bundle.url, clientId: bundle.clientId, clientSecret: bundle.clientSecret },
      catalog: starterCatalog(bundle),
      done,
    };

    const deadline = Date.now() + APPLY_SLICE_MS;
    const items: Doc<"setupImportItems">[] = await ctx.runQuery(internal.setupImports.pendingItems, { importId });
    let unfinished = false;
    for (const item of items) {
      if (Date.now() > deadline) {
        unfinished = true;
        break;
      }
      let outcome: Outcome;
      try {
        outcome = await applyItem(apply, item);
      } catch (err) {
        outcome = { outcome: "failed", message: errorMessage(err) };
      }
      done.set(item.key, { outcome: outcome.outcome, engineId: outcome.engineId ?? null });
      await ctx.runMutation(internal.setupImports.recordOutcome, { itemId: item._id, ...outcome });
    }

    if (unfinished) {
      await ctx.runMutation(internal.setupImports.releaseRun, { importId, status: "applying" });
      await ctx.scheduler.runAfter(0, internal.setupImports.apply, { importId });
      return;
    }
    await ctx.runMutation(internal.setupImports.releaseRun, { importId, status: "done" });
  },
});

export const runForApply = internalQuery({
  args: { importId: v.id("setupImports") },
  handler: async (ctx, { importId }): Promise<ImportReport | null> => {
    const run = await ctx.db.get(importId);
    return run ? toReport(run, []) : null;
  },
});
