import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const list = query({
  args: {
    instanceId: v.optional(v.id("instances")),
    search: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("moduleRepository").collect();

    if (args.instanceId) {
      results = results.filter((m) => m.instanceId === args.instanceId);
    }

    if (args.tags && args.tags.length > 0) {
      results = results.filter((m) => args.tags!.some((tag) => m.tags.includes(tag)));
    }

    if (args.search) {
      const lower = args.search.toLowerCase();
      results = results.filter(
        (m) => m.name.toLowerCase().includes(lower) || m.description.toLowerCase().includes(lower)
      );
    }

    return results;
  },
});

export const get = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.moduleId);
  },
});

export const getInternal = internalQuery({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.moduleId);
  },
});

const AUDIT_ROW_LIMIT = 5000;

/**
 * Read-only audit: module identities held by more than one instance.
 *
 * Before the lookups here and in moduleWebhook were instance-scoped, a webhook
 * could resolve another tenant's row by `moduleKey` or `name`+`version` and
 * patch, re-key or cascade-delete it. Scoping stops new collisions but repairs
 * nothing already cross-wired, and once an `instanceId` has been overwritten
 * there is no way to infer the original owner automatically. So this reports
 * rather than repairs — run it to find out whether a repair is needed at all:
 *
 *   bunx convex run moduleRepository:auditCrossTenantCollisions
 *
 * A clean deployment returns three empty arrays.
 */
export const auditCrossTenantCollisions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("moduleRepository").take(AUDIT_ROW_LIMIT);

    const byModuleKey: ModuleGroups = {};
    const byNameVersion: ModuleGroups = {};
    for (const row of rows) {
      if (row.moduleKey) {
        push(byModuleKey, row.moduleKey, row);
      }
      push(byNameVersion, `${row.name}@${row.version}`, row);
    }

    return {
      truncated: rows.length === AUDIT_ROW_LIMIT,
      sharedModuleKeys: collisions(byModuleKey),
      sharedNameVersions: collisions(byNameVersion),
      // Rows with no owner predate per-instance scoping (or are admin seeds).
      // They can never match an instance-scoped lookup, so they are inert —
      // listed so they can be attributed or dropped deliberately.
      unownedRows: rows.filter((r) => !r.instanceId).map((r) => ({ _id: r._id, name: r.name, version: r.version })),
    };
  },
});

type ModuleGroups = Record<string, Doc<"moduleRepository">[]>;

interface ModuleCollision {
  key: string;
  instanceIds: Array<Id<"instances"> | null>;
  moduleRowIds: Array<Id<"moduleRepository">>;
}

function push(groups: ModuleGroups, key: string, row: Doc<"moduleRepository">) {
  const existing = groups[key];
  if (existing) {
    existing.push(row);
    return;
  }
  groups[key] = [row];
}

/** Groups whose rows span more than one owning instance. */
function collisions(groups: ModuleGroups): ModuleCollision[] {
  const result: ModuleCollision[] = [];
  for (const [key, group] of Object.entries(groups)) {
    const instanceIds: Array<Id<"instances"> | null> = [];
    for (const row of group) {
      const owner = row.instanceId ?? null;
      if (!instanceIds.includes(owner)) {
        instanceIds.push(owner);
      }
    }
    if (instanceIds.length > 1) {
      result.push({ key, instanceIds, moduleRowIds: group.map((r) => r._id) });
    }
  }
  return result;
}

/**
 * Upload the zip to storage and deliver it to the engine.
 * Creates (or refreshes) a moduleRepository record in "pending" status so the
 * manifest we already parsed client-side is persisted immediately — the engine's
 * module.installed webhook carries no manifest, so this is the only point where
 * settings/resource declarations are captured. processModuleInstalled flips the
 * status to "installed" without touching the manifest field. Errors are
 * communicated via transientEvents.
 */
export const uploadAndDeliver = mutation({
  args: {
    instanceId: v.id("instances"),
    moduleKey: v.string(),
    name: v.string(),
    description: v.string(),
    version: v.string(),
    tags: v.array(v.string()),
    manifest: v.any(),
    archiveKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Scoped to the instance: an unscoped match would patch another tenant's
    // row — including its instanceId — and hand this module's identity over to
    // the uploader.
    const existing = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance_name_version", (q) =>
        q.eq("instanceId", args.instanceId).eq("name", args.name).eq("version", args.version)
      )
      .first();

    const fields = {
      instanceId: args.instanceId,
      moduleKey: args.moduleKey,
      name: args.name,
      description: args.description,
      version: args.version,
      tags: args.tags,
      manifest: args.manifest,
      archiveKey: args.archiveKey,
      status: "pending" as const,
      statusMessage: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("moduleRepository", fields);
    }

    await ctx.scheduler.runAfter(0, internal.moduleEngine.deliverZipToInstance, {
      instanceId: args.instanceId,
      moduleKey: args.moduleKey,
      archiveKey: args.archiveKey,
      fileName: `${args.name}-${args.version}.zip`,
      moduleMeta: {
        name: args.name,
        description: args.description,
        version: args.version,
        tags: args.tags,
        manifest: args.manifest,
      },
    });
    return { delivered: true };
  },
});

/**
 * Re-deliver an existing module record's archive to the engine.
 */
export const enqueueEngineInstall = mutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const module = await ctx.db.get(args.moduleId);
    if (!module) {
      throw new Error("Module not found");
    }
    if (!module.archiveKey) {
      throw new Error("Module has no archiveKey");
    }
    await ctx.scheduler.runAfter(0, internal.moduleEngine.deliverZipToInstance, {
      instanceId: args.instanceId,
      moduleKey: module.moduleKey ?? `${module.name}:${module.version}:unknown`,
      archiveKey: module.archiveKey,
      fileName: `${module.name}-${module.version}.zip`,
      moduleMeta: {
        name: module.name,
        description: module.description,
        version: module.version,
        tags: module.tags,
        manifest: module.manifest,
      },
    });
    return { enqueued: true };
  },
});

/**
 * Internal-only: cascade-delete a moduleRepository record, its archive blob,
 * and all triggerDefinitions/actionDefinitions rows that point at it.
 *
 * Called from the module.uninstalled webhook processor after the engine has
 * confirmed the uninstall. Not exposed to the UI — all user-initiated removals
 * go through the async requestModuleUninstall action.
 */
export const deleteRepositoryRecord = internalMutation({
  args: {
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    const module = await ctx.db.get(args.moduleId);
    if (!module) {
      return;
    }
    if (module.archiveKey) {
      await ctx.storage.delete(module.archiveKey as Id<"_storage">);
    }

    const triggers = await ctx.db
      .query("triggerDefinitions")
      .withIndex("by_module", (q) => q.eq("moduleId", args.moduleId))
      .collect();
    for (const trigger of triggers) {
      await ctx.db.delete(trigger._id);
    }

    const actions = await ctx.db
      .query("actionDefinitions")
      .withIndex("by_module", (q) => q.eq("moduleId", args.moduleId))
      .collect();
    for (const action of actions) {
      await ctx.db.delete(action._id);
    }

    await ctx.db.delete(args.moduleId);
  },
});

/**
 * Internal-only: overwrite a moduleRepository record's cached manifest.
 * Called after install confirmation once the engine's authoritative manifest
 * (fetched via getModuleManifest) is available — see moduleManifestSync.ts.
 */
export const setManifest = internalMutation({
  args: {
    moduleId: v.id("moduleRepository"),
    manifest: v.any(),
  },
  handler: async (ctx, { moduleId, manifest }) => {
    await ctx.db.patch(moduleId, { manifest });
  },
});

export const getDeliveryData = internalQuery({
  args: {
    instanceId: v.id("instances"),
    archiveKey: v.string(),
  },
  handler: async (ctx, args) => {
    const instance = await ctx.db.get(args.instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }
    const archiveUrl = await ctx.storage.getUrl(args.archiveKey as Id<"_storage">);
    if (!archiveUrl) {
      throw new Error("Module archive not found in storage");
    }
    return {
      instanceUrl: instance.url,
      clientId: instance.clientId ?? null,
      clientSecret: instance.clientSecret ?? null,
      archiveUrl,
    };
  },
});

export const resolveModuleForDetail = internalQuery({
  args: { instanceId: v.id("instances"), moduleId: v.string() },
  handler: async (ctx, { instanceId, moduleId }) => {
    try {
      const byId = await ctx.db.get(moduleId as Id<"moduleRepository">);
      if (byId && byId.instanceId === instanceId) {
        return byId;
      }
    } catch {
      // not a valid _id format — fall through to prefix match
    }

    const all = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    return all.find((m) => m.moduleKey?.startsWith(`${moduleId}:`)) ?? null;
  },
});
