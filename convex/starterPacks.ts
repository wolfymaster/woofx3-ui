import { getAuthUserId } from "@convex-dev/auth/server";
import type { WorkflowDefinition } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalMutation, internalQuery, type QueryCtx, query } from "./_generated/server";
import { createCommandInEngine } from "./chatCommandActions";
import { canonicalRefFromProjectionKey } from "./lib/canonicalRef";
import { fetchEngineCapabilities } from "./lib/engineCapabilities";
import {
  buildStarterCommand,
  buildStarterWorkflow,
  findStarterPack,
  hasRequirements,
  missingRequirements,
  requirementsMessage,
  STARTER_PACKS,
  type StarterCatalog,
  type StarterCommandItem,
  type StarterItem,
  starterFeaturesFrom,
  starterItemKey,
  validateStarterValues,
} from "./lib/starterPacks";
import { getInstanceMembership } from "./lib/teamAccess";
import { createWorkflowInEngine, EngineConfirmationTimeout } from "./workflowActions";
import type { CatalogBundle } from "./workflowCatalogContext";

/**
 * An install that has not finished within this long is taken to have died
 * (the action crashed or timed out) and no longer blocks another attempt.
 * Well above the engine's 10s confirmation wait per item.
 */
const INSTALL_CLAIM_TTL_MS = 60_000;

/**
 * How long a workflow item waits for a late webhook echo before another
 * install may try it again. Longer than INSTALL_CLAIM_TTL_MS because the engine
 * may already have created the workflow, and a retry would duplicate it.
 */
const INSTALL_ECHO_TTL_MS = 5 * 60_000;

/** Whether an item is in place, as the Starter packs page shows it. */
export type StarterItemState = "installed" | "installing" | "conflict" | "available";

/** How one item of an install went. */
export type StarterInstallOutcome = {
  itemId: string;
  outcome: "installed" | "already-installed" | "pending" | "conflict" | "busy" | "unavailable" | "failed";
  message?: string;
};

type ItemRow = Doc<"starterPackItems">;

async function engineObjectExists(ctx: QueryCtx, row: ItemRow): Promise<boolean> {
  if (row.engineId === undefined) {
    return false;
  }
  const engineId = row.engineId;
  if (row.kind === "workflow") {
    const workflow = await ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", row.instanceId).eq("engineWorkflowId", engineId))
      .first();
    return workflow !== null;
  }
  const command = await ctx.db
    .query("chatCommands")
    .withIndex("by_engine_command_id", (q) => q.eq("instanceId", row.instanceId).eq("engineCommandId", engineId))
    .first();
  return command !== null;
}

async function rowState(ctx: QueryCtx, row: ItemRow, now: number): Promise<"installed" | "installing" | "stale"> {
  if (row.status === "installing") {
    const ttl = row.correlationKey === undefined ? INSTALL_CLAIM_TTL_MS : INSTALL_ECHO_TTL_MS;
    return now - row.claimedAt < ttl ? "installing" : "stale";
  }
  return (await engineObjectExists(ctx, row)) ? "installed" : "stale";
}

async function commandNamesInUse(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Set<string>> {
  const commands = await ctx.db
    .query("chatCommands")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(500);
  return new Set(commands.map((command) => command.command.toLowerCase()));
}

/**
 * Where each starter pack item stands on this instance, keyed by
 * `starterItemKey`. A command whose name another command already has is a
 * conflict: installing it would fail, and replacing someone's own command is
 * not what a starter pack is for. Null when the caller is not a member.
 */
export const status = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Record<string, StarterItemState> | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    if (!(await getInstanceMembership(ctx, instanceId, userId))) {
      return null;
    }

    const now = Date.now();
    const rows = await ctx.db
      .query("starterPackItems")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(200);
    const tracked = new Map<string, "installed" | "installing" | "stale">();
    for (const row of rows) {
      tracked.set(starterItemKey(row.packId, row.itemId), await rowState(ctx, row, now));
    }
    const namesInUse = await commandNamesInUse(ctx, instanceId);

    const states: Record<string, StarterItemState> = {};
    for (const pack of STARTER_PACKS) {
      for (const item of pack.items) {
        const key = starterItemKey(pack.id, item.id);
        const state = tracked.get(key);
        if (state === "installed" || state === "installing") {
          states[key] = state;
        } else if (item.kind === "command" && namesInUse.has(item.command)) {
          states[key] = "conflict";
        } else {
          states[key] = "available";
        }
      }
    }
    return states;
  },
});

type ItemClaim =
  | { state: "claimed"; rowId: Id<"starterPackItems"> }
  | { state: "installed" }
  | { state: "busy" }
  | { state: "conflict" };

/**
 * Reserve an item for installing. Runs as one transaction, so of two installs
 * racing for the same item exactly one gets `claimed`.
 */
export const claimItem = internalMutation({
  args: {
    instanceId: v.id("instances"),
    packId: v.string(),
    itemId: v.string(),
    kind: v.union(v.literal("workflow"), v.literal("command")),
    commandName: v.optional(v.string()),
    correlationKey: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, packId, itemId, kind, commandName, correlationKey }): Promise<ItemClaim> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("starterPackItems")
      .withIndex("by_instance_item", (q) => q.eq("instanceId", instanceId).eq("packId", packId).eq("itemId", itemId))
      .first();
    if (existing) {
      const state = await rowState(ctx, existing, now);
      if (state === "installed") {
        return { state: "installed" };
      }
      if (state === "installing") {
        return { state: "busy" };
      }
      await ctx.db.delete(existing._id);
    }
    if (commandName !== undefined && (await commandNamesInUse(ctx, instanceId)).has(commandName)) {
      return { state: "conflict" };
    }
    const rowId = await ctx.db.insert("starterPackItems", {
      instanceId,
      packId,
      itemId,
      kind,
      status: "installing",
      correlationKey,
      claimedAt: now,
    });
    return { state: "claimed", rowId };
  },
});

export const completeItem = internalMutation({
  args: { rowId: v.id("starterPackItems"), engineId: v.string() },
  handler: async (ctx, { rowId, engineId }) => {
    if (!(await ctx.db.get(rowId))) {
      return;
    }
    await ctx.db.patch(rowId, { status: "installed", engineId });
  },
});

export const releaseItem = internalMutation({
  args: { rowId: v.id("starterPackItems") },
  handler: async (ctx, { rowId }) => {
    if (!(await ctx.db.get(rowId))) {
      return;
    }
    await ctx.db.delete(rowId);
  },
});

/** Engine ids of the named built-in command groups, as mirrored from the engine. */
export const builtInGroupIds = internalQuery({
  args: { instanceId: v.id("instances"), names: v.array(v.string()) },
  handler: async (ctx, { instanceId, names }): Promise<Record<string, string>> => {
    const groups = await ctx.db
      .query("chatCommandGroups")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(200);
    const ids: Record<string, string> = {};
    for (const group of groups) {
      if (group.isBuiltIn === true && names.includes(group.name)) {
        ids[group.name] = group.engineGroupId;
      }
    }
    return ids;
  },
});

export function starterCatalog(bundle: CatalogBundle): StarterCatalog {
  const triggers = bundle.enabledTriggerIds
    .map((id) => bundle.triggerDefs[id])
    .filter((def) => def !== undefined)
    .map((def) => ({ event: def.event, canonicalRef: canonicalRefFromProjectionKey(def.projectionKey, "trigger") }));
  const actions = bundle.enabledActionIds
    .map((id) => bundle.actionDefs[id])
    .filter((def) => def !== undefined)
    .map((def) => ({
      canonicalRef: canonicalRefFromProjectionKey(def.projectionKey, "action"),
      handlerType: def.handlerType,
      functionCall: def.functionCall,
      configFields: def.configFields,
    }));
  return { triggers, actions };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Install a starter pack: create each of its items that is not already in
 * place, through the same engine paths the workflow wizard and command editor
 * use. Safe to run again: installed items are skipped, and so are commands
 * whose name is taken. Items the instance cannot run yet (an engine or module
 * too old) are skipped and reported, and the rest still install.
 */
export const install = action({
  args: {
    instanceId: v.id("instances"),
    packId: v.string(),
    values: v.record(v.string(), v.union(v.string(), v.number())),
  },
  handler: async (ctx, { instanceId, packId, values }): Promise<{ results: StarterInstallOutcome[] }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    // Resolves only for a member of the instance.
    const bundle: CatalogBundle | null = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
      instanceId,
      userId,
    });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }
    return { results: await installStarterPack(ctx, instanceId, bundle, packId, values) };
  },
});

/**
 * `install` for an instance rather than a signed-in user, with each field at
 * its default. Applies the packs chosen at setup once the engine is ready; the
 * same ledger keeps it safe to run again.
 */
export async function installStarterPackWithDefaults(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  packId: string
): Promise<StarterInstallOutcome[]> {
  const bundle: CatalogBundle | null = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForInstance, {
    instanceId,
  });
  if (!bundle) {
    throw new Error("Instance not found");
  }
  return installStarterPack(ctx, instanceId, bundle, packId, {});
}

async function installStarterPack(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  bundle: CatalogBundle,
  packId: string,
  values: Record<string, string | number>
): Promise<StarterInstallOutcome[]> {
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  const instance = { url: bundle.url, clientId: bundle.clientId, clientSecret: bundle.clientSecret };

  const pack = findStarterPack(packId);
  if (!pack) {
    throw new Error(`Unknown starter pack "${packId}"`);
  }
  const capabilities = await fetchEngineCapabilities(instance);
  const checked = validateStarterValues(pack, values, starterFeaturesFrom(capabilities.capabilities));
  if (!checked.ok) {
    throw new Error(Object.values(checked.errors).join(" "));
  }
  const catalog = starterCatalog(bundle);

  const installCommand = async (item: StarterCommandItem): Promise<string> => {
    const built = buildStarterCommand(item, checked.values, catalog);
    let groupIds: string[] = [];
    if (built.restrictTo.length > 0) {
      const ids: Record<string, string> = await ctx.runQuery(internal.starterPacks.builtInGroupIds, {
        instanceId,
        names: built.restrictTo,
      });
      const unsynced = built.restrictTo.filter((name) => ids[name] === undefined);
      if (unsynced.length > 0) {
        throw new Error(`The ${unsynced.join(" and ")} command groups have not synced from the engine yet.`);
      }
      groupIds = built.restrictTo.map((name) => ids[name]);
    }
    return createCommandInEngine(ctx, instanceId, instance, {
      command: built.command,
      actions: built.actions,
      cooldown: built.cooldown,
      enabled: true,
      visibility: groupIds.length > 0 ? "restricted" : "public",
      groupIds,
    });
  };

  const installItem = async (item: StarterItem): Promise<StarterInstallOutcome> => {
    const missing = missingRequirements(item, catalog);
    if (!hasRequirements(missing)) {
      return { itemId: item.id, outcome: "unavailable", message: requirementsMessage(missing) ?? undefined };
    }
    const correlationKey = item.kind === "workflow" ? crypto.randomUUID() : undefined;
    const claim = await ctx.runMutation(internal.starterPacks.claimItem, {
      instanceId,
      packId: pack.id,
      itemId: item.id,
      kind: item.kind,
      commandName: item.kind === "command" ? item.command : undefined,
      correlationKey,
    });
    if (claim.state === "installed") {
      return { itemId: item.id, outcome: "already-installed" };
    }
    if (claim.state === "busy") {
      return { itemId: item.id, outcome: "busy", message: "Another install of this item is in progress." };
    }
    if (claim.state === "conflict") {
      return { itemId: item.id, outcome: "conflict", message: "A command with this name already exists." };
    }

    try {
      const engineId =
        item.kind === "workflow"
          ? await createWorkflowInEngine(
              ctx,
              instanceId,
              instance,
              // Carries a delay wait, which the shared WorkflowDefinition type does not model yet.
              buildStarterWorkflow(item, checked.values, catalog) as unknown as Omit<WorkflowDefinition, "id">,
              correlationKey
            )
          : await installCommand(item);
      await ctx.runMutation(internal.starterPacks.completeItem, { rowId: claim.rowId, engineId });
      return { itemId: item.id, outcome: "installed" };
    } catch (err) {
      if (err instanceof EngineConfirmationTimeout) {
        // The row keeps its correlation key; the echo marks it installed when it lands.
        return {
          itemId: item.id,
          outcome: "pending",
          message: "The engine has not confirmed it yet. It will show as installed once it does.",
        };
      }
      await ctx.runMutation(internal.starterPacks.releaseItem, { rowId: claim.rowId });
      return { itemId: item.id, outcome: "failed", message: errorMessage(err) };
    }
  };

  const results: StarterInstallOutcome[] = [];
  for (const item of pack.items) {
    results.push(await installItem(item));
  }
  return results;
}
