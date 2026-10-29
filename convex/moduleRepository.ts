import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { isInstanceMember } from "./lib/teamAccess";
import { installedModulesRevision } from "./lib/widgetThemes";

export const list = query({
  args: {
    instanceId: v.id("instances"),
    search: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    if (!(await isInstanceMember(ctx, args.instanceId))) {
      return [];
    }
    let results = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .collect();

    if (args.tags && args.tags.length > 0) {
      results = results.filter((m) => args.tags?.some((tag) => m.tags.includes(tag)));
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

/**
 * Changes whenever a module on the instance is installed, upgraded or removed,
 * for a view that holds engine data derived from the installed set (a widget's
 * theme list) and must refetch it. Empty for a caller who is not a member.
 */
export const installedRevision = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<string> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return "";
    }
    const rows = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    return installedModulesRevision(rows);
  },
});

export const get = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, args) => {
    const module = await ctx.db.get(args.moduleId);
    if (!module?.instanceId || !(await isInstanceMember(ctx, module.instanceId))) {
      return null;
    }
    return module;
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

export const resolveModuleForDetail = internalQuery({
  args: { instanceId: v.id("instances"), moduleId: v.string() },
  handler: async (ctx, { instanceId, moduleId }) => {
    // `moduleId` is either a repository row id or a marketplace id; only the
    // first normalizes.
    const rowId = ctx.db.normalizeId("moduleRepository", moduleId);
    if (rowId) {
      const byId = await ctx.db.get(rowId);
      if (byId && byId.instanceId === instanceId) {
        return byId;
      }
    }

    const all = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    return all.find((m) => m.moduleKey?.startsWith(`${moduleId}:`)) ?? null;
  },
});
