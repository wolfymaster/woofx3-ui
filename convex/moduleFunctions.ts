import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query } from "./_generated/server";

const functionValidator = v.object({
  id: v.string(),
  // Not used to build qualifiedName — see canonicalFunctionId below for why —
  // but the raw webhook payload includes them and Convex validators reject
  // unlisted extra fields, so they must stay declared here even though we
  // ignore their values.
  canonicalId: v.optional(v.string()),
  moduleId: v.optional(v.string()),
  projectionKey: v.optional(v.string()),
  manifestId: v.optional(v.string()),
  name: v.optional(v.string()),
  fileName: v.optional(v.string()),
  entryPoint: v.optional(v.string()),
  runtime: v.optional(v.string()),
});

// Barkloader's ModuleRegistry::get_function resolves the invoke path as
// `{moduleId}:function:{manifestId}` (colon-separated, literal "function"
// middle segment). `moduleId` here is the manifest's own declared `id` field
// (module_manifest.rs::compute_module_key: `{id}:{version}:{hash}`) — NOT
// the engine's `FunctionDefinition.moduleId`/`AvailableFunction.moduleId`,
// which is a DB row UUID (commands.ts's listAvailableFunctions sets it from
// `m.id`, not the manifest id — confirmed wrong by testing against a real
// engine). moduleKey (which we already store per-module in moduleRepository)
// is built from that same manifest id as its first colon segment, so derive
// the canonical id from moduleKey instead of trusting any engine-supplied
// "moduleId" field.
function canonicalFunctionId(moduleKey: string, manifestId: string): string {
  const engineModuleId = moduleKey.split(":")[0];
  if (engineModuleId) {
    return `${engineModuleId}:function:${manifestId}`;
  }
  // No moduleKey to derive from — fall back to the manifestId alone rather
  // than crash. Not expected in practice since moduleKey is required to
  // look up the moduleRepository row in the first place.
  return manifestId;
}

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
  projectionKey: string | undefined
) {
  const existing = await ctx.db
    .query("instanceFunctions")
    .withIndex("by_instance_function", (q) => q.eq("instanceId", instanceId).eq("functionId", functionId))
    .first();
  if (!existing) {
    await ctx.db.insert("instanceFunctions", {
      instanceId,
      functionId,
      projectionKey,
    });
  }
}

async function disableFunctionForInstance(ctx: MutationCtx, instanceId: Id<"instances">, functionId: string) {
  const existing = await ctx.db
    .query("instanceFunctions")
    .withIndex("by_instance_function", (q) => q.eq("instanceId", instanceId).eq("functionId", functionId))
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
      .withIndex("by_instance_module_key", (q) => q.eq("instanceId", instanceId).eq("moduleKey", moduleKey))
      .first();

    const moduleId =
      moduleRecord?._id ??
      (
        await ctx.db
          .query("moduleRepository")
          .withIndex("by_instance_name_version", (q) =>
            q.eq("instanceId", instanceId).eq("name", moduleName).eq("version", version)
          )
          .first()
      )?._id;

    if (!moduleId) {
      // No moduleRepository row yet — the install event may arrive after this
      // function registration. Skip writing rather than orphan; the install
      // handler will re-trigger registration via processRegisteredDefinitions.
      return;
    }

    for (const fn of functions) {
      const manifestId = fn.manifestId ?? fn.id;
      const row = {
        moduleId,
        engineFunctionId: fn.id,
        projectionKey: fn.projectionKey,
        manifestId: fn.manifestId,
        moduleName,
        functionName: fn.name ?? fn.manifestId ?? fn.id,
        qualifiedName: canonicalFunctionId(moduleKey, manifestId),
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
