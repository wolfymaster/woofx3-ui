import { v } from "convex/values";
import { query } from "./_generated/server";
import { manifestModuleName, parseManifestResourceKinds } from "./lib/resourceKinds";

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
  },
});
