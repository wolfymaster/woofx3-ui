import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import {
  type KindDeclarer,
  manifestModuleName,
  parseManifestResourceKinds,
  resolveResourceKind,
} from "./lib/resourceKinds";
import { isInstanceMember } from "./lib/teamAccess";

/**
 * The installed module that provides a resource kind on this instance, and the
 * kind's definition. `kind` is `module:kind`, or a bare kind declared by exactly
 * one installed module. Null when it means no installed declaration — a
 * first-party resource page reads that as "the module providing this is not
 * installed".
 */
export const getForInstance = query({
  args: { instanceId: v.id("instances"), kind: v.string() },
  handler: async (ctx, { instanceId, kind }) => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    return findResourceKind(ctx, instanceId, kind);
  },
});

/** The installed module that declares a resource kind, and its declaration; null when none does. */
export async function findResourceKind(ctx: QueryCtx, instanceId: Id<"instances">, kind: string) {
  const modules = await ctx.db
    .query("moduleRepository")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .collect();
  // One declarer per module: a module can hold more than one row here, and its
  // rows declaring the same kind twice must not read as two modules doing so.
  const declarers = new Map<string, KindDeclarer>();
  for (const module of modules) {
    const moduleName = manifestModuleName(module.manifest, module.name);
    if (!declarers.has(moduleName)) {
      declarers.set(moduleName, { moduleName, kinds: parseManifestResourceKinds(module.manifest) });
    }
  }
  const resolved = resolveResourceKind([...declarers.values()], kind);
  if (!resolved) {
    return null;
  }
  return { moduleName: resolved.moduleName, ...resolved.declaration };
}
