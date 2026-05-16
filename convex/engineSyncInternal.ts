import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// One-shot cleanup for the orphan instanceSync rows that exist in the
// pre-spec deployment. Safe to delete after the first prod deploy.
export const dropAllInstanceSync = internalMutation({
  args: {},
  handler: async (ctx) => {
    // One-shot cleanup. Orphan count is small (3 in dev as of writing) — take
    // a generous ceiling that's still well under Convex read limits.
    const rows = await ctx.db.query("instanceSync").take(100);
    for (const r of rows) {
      await ctx.db.delete(r._id);
    }
    return rows.length;
  },
});

/**
 * Reconcile the local `chatCommands` mirror against a full snapshot
 * returned by the engine's `listCommands()`. The engine is the source of
 * truth: rows whose `engineCommandId` is present in the snapshot are
 * upserted; rows with an `engineCommandId` that no longer appears are
 * deleted. Rows that have no `engineCommandId` at all (locally-created
 * but never pushed to the engine) are left alone.
 *
 * The engine's `CommandSnapshot` (see `@woofx3/api`) carries the
 * type-discriminated payload in a single `typeValue` string. The legacy
 * Convex-side fields `response` / `template` / `functionId` are not
 * sourced from the engine and are not touched by this reconciler.
 */
export const reconcileCommands = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    snapshots: v.array(
      v.object({
        engineCommandId: v.string(),
        command: v.string(),
        type: v.union(v.literal("static"), v.literal("dynamic"), v.literal("function")),
        typeValue: v.string(),
        cooldown: v.number(),
        priority: v.number(),
        enabled: v.boolean(),
      })
    ),
  },
  handler: async (ctx, { instanceId, applicationId, snapshots }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("chatCommands")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();

    const existingByEngineId = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      if (row.engineCommandId) {
        existingByEngineId.set(row.engineCommandId, row);
      }
    }

    const snapshotIds = new Set(snapshots.map((s) => s.engineCommandId));
    let processed = 0;

    for (const snap of snapshots) {
      const found = existingByEngineId.get(snap.engineCommandId);
      if (found) {
        await ctx.db.patch(found._id, {
          applicationId,
          command: snap.command,
          type: snap.type,
          typeValue: snap.typeValue,
          cooldown: snap.cooldown,
          priority: snap.priority,
          enabled: snap.enabled,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("chatCommands", {
          instanceId,
          applicationId,
          engineCommandId: snap.engineCommandId,
          command: snap.command,
          type: snap.type,
          typeValue: snap.typeValue,
          cooldown: snap.cooldown,
          priority: snap.priority,
          enabled: snap.enabled,
          createdAt: now,
          updatedAt: now,
        });
      }
      processed++;
    }

    // Delete rows whose engineCommandId disappeared from the engine.
    // Rows with no engineCommandId (locally-created, never pushed) are skipped.
    for (const row of existing) {
      if (row.engineCommandId && !snapshotIds.has(row.engineCommandId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
  },
});

/**
 * Reconcile the local `installedModules` mirror against a full snapshot
 * returned by the engine's `listEngineModules()`. The engine is the source
 * of truth: rows whose `name` is present in the snapshot are upserted;
 * rows with a `name` that no longer appears are deleted.
 */
export const reconcileModules = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshots: v.array(
      v.object({
        name: v.string(),
        version: v.string(),
        state: v.string(),
      })
    ),
  },
  handler: async (ctx, { instanceId, snapshots }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("installedModules")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();

    const existingByName = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      existingByName.set(row.name, row);
    }

    const snapshotNames = new Set(snapshots.map((s) => s.name));
    let processed = 0;

    for (const snap of snapshots) {
      const found = existingByName.get(snap.name);
      if (found) {
        if (found.version !== snap.version || found.state !== snap.state) {
          await ctx.db.patch(found._id, {
            version: snap.version,
            state: snap.state,
            updatedAt: now,
          });
        }
      } else {
        await ctx.db.insert("installedModules", {
          instanceId,
          name: snap.name,
          version: snap.version,
          state: snap.state,
          updatedAt: now,
        });
      }
      processed++;
    }

    for (const row of existing) {
      if (!snapshotNames.has(row.name)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
  },
});
