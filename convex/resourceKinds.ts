import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { manifestModuleName, parseManifestResourceKinds } from "./lib/resourceKinds";
import { isInstanceMember } from "./lib/teamAccess";

/**
 * The installed module that provides a resource kind on this instance, and the
 * kind's definition. Null when no installed module declares it — a first-party
 * resource page reads that as "the module providing this is not installed".
 *
 * First declaration wins. Kinds are an open namespace, so two modules could
 * each declare one called `counter`; a first-party page means the bundled one,
 * which is installed on every instance.
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
  for (const module of modules) {
    const declared = parseManifestResourceKinds(module.manifest).find((entry) => entry.kind === kind);
    if (declared) {
      return { moduleName: manifestModuleName(module.manifest, module.name), ...declared };
    }
  }
  return null;
}
