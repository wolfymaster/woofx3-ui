import { COUNTER_KIND } from "@shared/resource-kinds";
import { type AppliedItems, applyImportItem, type ImportEngine, type ImportOutcome } from "@shared/setup-import/apply";
import {
  convertDocument,
  ImportDocumentError,
  MAX_IMPORT_ITEMS,
  type PlannedItem,
  planItems,
} from "@shared/setup-import/plan";
import type { ImportPlan, ImportSource } from "@shared/setup-import/types";
import type { StarterCatalog } from "@shared/starter-packs";
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
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { findEngineMergeTarget } from "./lib/engineWorkflows";
import { requireInstanceRole, requireInstanceRoleInAction } from "./lib/instanceAccess";
import { isInstanceMember } from "./lib/teamAccess";
import { findResourceKind } from "./resourceKinds";
import { starterCatalog } from "./starterPacks";
import {
  appendWorkflowSteps,
  createWorkflowInEngine,
  EngineConfirmationTimeout,
  type InstanceContext,
} from "./workflowActions";
import type { CatalogBundle } from "./workflowCatalogContext";

/**
 * Bringing a streamer's setup over from Firebot or Streamer.bot.
 *
 * `analyze` converts the export (opened in the browser by
 * shared/setup-import/decode.ts) and stores the result for review. `start` queues
 * it, and `apply` creates each item through the same functions the workflow
 * builder, command editor, groups page and counters page use, so the engine
 * sees ordinary user-made objects. Applying runs in the background in slices,
 * reporting per item, so an import of hundreds of items survives action time
 * limits and the report fills in as it goes.
 */

const sourceValidator = v.union(v.literal("firebot"), v.literal("streamerbot"));

/** More than any real setup has; keeps one import inside a few mutations' write limits. */
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
    let plan: ImportPlan;
    let items: PlannedItem[];
    try {
      plan = convertDocument(source, documentChunks.join(""));
      items = planItems(plan);
    } catch (err) {
      if (err instanceof ImportDocumentError) {
        throw new ConvexError(err.message);
      }
      throw err;
    }

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

interface ApplyContext {
  ctx: ActionCtx;
  instanceId: Id<"instances">;
  importId: Id<"setupImports">;
  source: ImportSource;
  instance: InstanceContext;
  catalog: StarterCatalog;
  /** Mints the key a workflow create is matched to the engine's echo by. */
  newCorrelationKey: () => string;
}

/** The engine as an import sees it in the hosted app: Convex's mirror to look things up, the engine's own API to change them. */
function convexImportEngine(apply: ApplyContext): ImportEngine {
  const { ctx, instanceId, instance } = apply;
  const rpc = () => createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
  return {
    source: apply.source,
    catalog: apply.catalog,
    findExisting: (kind, item, name) =>
      ctx.runQuery(internal.setupImports.existing, {
        instanceId,
        source: apply.source,
        key: item.key,
        kind,
        name,
      }),
    counterModule: async () => {
      const kind = await ctx.runQuery(internal.setupImports.counterKind, { instanceId });
      return kind ? kind.moduleName : null;
    },
    createCounter: async (moduleName, spec) => {
      const result = await rpc().createResourceInstance(
        moduleName,
        "counter",
        spec.resourceInstanceId,
        spec.displayName,
        {
          lifetime: "forever",
          initialValue: spec.initialValue,
          step: 1,
        }
      );
      return result.canonicalId;
    },
    builtInGroupIds: (names) => ctx.runQuery(internal.starterPacks.builtInGroupIds, { instanceId, names: [...names] }),
    createGroup: (group) => createGroupInEngine(ctx, instanceId, instance, group),
    addGroupMember: async (engineGroupId, username) => {
      await addGroupMemberInEngine(ctx, instanceId, instance, engineGroupId, username);
    },
    createCommand: (command) => createCommandInEngine(ctx, instanceId, instance, command),
    placeWorkflow: async (item, definition) => {
      const correlationKey = apply.newCorrelationKey();
      await ctx.runMutation(internal.setupImports.setCorrelation, {
        itemId: item.ref as Id<"setupImportItems">,
        correlationKey,
      });
      try {
        const target = await findEngineMergeTarget(instance, definition.trigger as Record<string, unknown>);
        const engineId =
          target === undefined
            ? await createWorkflowInEngine(
                ctx,
                instanceId,
                instance,
                // Carries delay waits and `$ref`s, which the shared WorkflowDefinition type does not model.
                definition as unknown as Omit<WorkflowDefinition, "id">,
                correlationKey
              )
            : await appendWorkflowSteps(
                ctx,
                instanceId,
                instance,
                target,
                definition.tasks as unknown as readonly Record<string, unknown>[],
                correlationKey
              );
        // Its enabled state is set by completeImportItemByCorrelation when the
        // create's echo arrives.
        return { engineId };
      } catch (err) {
        if (err instanceof EngineConfirmationTimeout) {
          return "pending";
        }
        throw err;
      }
    },
  };
}

async function applyItem(
  apply: ApplyContext,
  applied: AppliedItems,
  item: Doc<"setupImportItems">
): Promise<ImportOutcome> {
  if (item.outcome === "pending" && item.correlationKey !== undefined) {
    const engineId = await apply.ctx.runQuery(internal.setupImports.completion, {
      correlationKey: item.correlationKey,
    });
    return engineId === null ? { outcome: "pending", message: item.message } : { outcome: "created", engineId };
  }
  return applyImportItem(convexImportEngine(apply), applied, {
    ref: item._id,
    key: item.key,
    kind: item.kind,
    name: item.name,
    origin: item.origin,
    notes: item.notes,
    readiness: item.readiness,
    spec: item.spec,
  });
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
      newCorrelationKey: () => crypto.randomUUID(),
    };

    const deadline = Date.now() + APPLY_SLICE_MS;
    const items: Doc<"setupImportItems">[] = await ctx.runQuery(internal.setupImports.pendingItems, { importId });
    let unfinished = false;
    for (const item of items) {
      if (Date.now() > deadline) {
        unfinished = true;
        break;
      }
      let outcome: ImportOutcome;
      try {
        outcome = await applyItem(apply, done, item);
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
