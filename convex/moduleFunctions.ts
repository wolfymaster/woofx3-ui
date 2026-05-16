import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx } from "./_generated/server";

const functionValidator = v.object({
  id: v.string(),
  canonicalId: v.optional(v.string()),
  projectionKey: v.optional(v.string()),
  moduleId: v.optional(v.string()),
  manifestId: v.optional(v.string()),
  name: v.optional(v.string()),
  fileName: v.optional(v.string()),
  entryPoint: v.optional(v.string()),
  runtime: v.optional(v.string()),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("moduleFunctions").collect();
  },
});

export const listByModule = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, { moduleId }) => {
    return ctx.db
      .query("moduleFunctions")
      .withIndex("by_module", (q) => q.eq("moduleId", moduleId))
      .collect();
  },
});

async function enableFunctionForInstance(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  functionId: string,
  projectionKey: string | undefined,
) {
  const existing = await ctx.db
    .query("instanceEnabledFunctions")
    .withIndex("by_instance_function", (q) =>
      q.eq("instanceId", instanceId).eq("functionId", functionId),
    )
    .first();
  if (!existing) {
    await ctx.db.insert("instanceEnabledFunctions", {
      instanceId,
      functionId,
      projectionKey,
    });
  }
}

async function disableFunctionForInstance(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  functionId: string,
) {
  const existing = await ctx.db
    .query("instanceEnabledFunctions")
    .withIndex("by_instance_function", (q) =>
      q.eq("instanceId", instanceId).eq("functionId", functionId),
    )
    .first();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleKey: v.string(),
    moduleName: v.string(),
    version: v.string(),
    functions: v.array(functionValidator),
  },
  handler: async (ctx, { instanceId, moduleKey, moduleName, version, functions }) => {
    const moduleRecord = await ctx.db
      .query("moduleRepository")
      .withIndex("by_module_key", (q) => q.eq("moduleKey", moduleKey))
      .first();

    const moduleId =
      moduleRecord?._id ??
      (
        await ctx.db
          .query("moduleRepository")
          .withIndex("by_name_version", (q) => q.eq("name", moduleName).eq("version", version))
          .first()
      )?._id;

    if (!moduleId) {
      // No moduleRepository row yet — the install event may arrive after this
      // function registration. Skip writing rather than orphan; the install
      // handler will re-trigger registration via processRegisteredDefinitions.
      return;
    }

    for (const fn of functions) {
      const row = {
        moduleId,
        engineFunctionId: fn.id,
        projectionKey: fn.projectionKey,
        manifestId: fn.manifestId,
        moduleName,
        functionName: fn.name ?? fn.manifestId ?? fn.id,
        qualifiedName: `${moduleName}/${fn.manifestId ?? fn.name ?? fn.id}`,
        fileName: fn.fileName ?? "",
        entryPoint: fn.entryPoint ?? "",
        runtime: fn.runtime ?? "",
      };

      const existing = await ctx.db
        .query("moduleFunctions")
        .withIndex("by_engine_id", (q) => q.eq("engineFunctionId", fn.id))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("moduleFunctions", row);
      }
      await enableFunctionForInstance(ctx, instanceId, fn.id, fn.projectionKey);
    }
  },
});

export const deleteFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    functions: v.array(functionValidator),
  },
  handler: async (ctx, { instanceId, functions }) => {
    for (const fn of functions) {
      const existing = await ctx.db
        .query("moduleFunctions")
        .withIndex("by_engine_id", (q) => q.eq("engineFunctionId", fn.id))
        .first();
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      await disableFunctionForInstance(ctx, instanceId, fn.id);
    }
  },
});

export const cascadeOnModuleDelete = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, { instanceId, moduleId }) => {
    const rows = await ctx.db
      .query("moduleFunctions")
      .withIndex("by_module", (q) => q.eq("moduleId", moduleId))
      .collect();
    for (const row of rows) {
      await disableFunctionForInstance(ctx, instanceId, row.engineFunctionId);
      await ctx.db.delete(row._id);
    }
  },
});
