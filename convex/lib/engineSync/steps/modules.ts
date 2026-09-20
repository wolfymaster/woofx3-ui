import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * modulesStep — full-snapshot reconciliation of installed modules.
 *
 * Calls `listEngineModules()` for every module the engine has installed, with
 * the manifest each was installed from, and forwards the snapshot to
 * `internal.engineSyncInternal.reconcileModules`.
 *
 * The manifest is the point. A module's `resources[]` is the only declaration
 * of the resource kinds it provides, and `resourceKinds.getForInstance` reads
 * them from `moduleRepository.manifest` — but the `module.installed` webhook
 * has no manifest field, so `processModuleInstalled` stores `{}`. Only the
 * dashboard upload path ever wrote a real one, which left every module the
 * engine installs by itself (the bundled ones, from barkloader's boot
 * reconciler) with no declared kinds, or no row at all.
 *
 * Catalog fields come off the manifest here rather than in the mutation, so
 * the writer takes values and does not parse.
 */
export const modulesStep: SyncStep = {
  name: "modules",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const modules = await newApi().listEngineModules();
    const snapshots = modules.map((module) => {
      const manifest = module.manifest ?? {};
      return {
        name: module.name,
        version: module.version,
        moduleId: module.moduleId,
        moduleKey: module.moduleKey,
        manifest,
        description: asString(manifest.description),
        author: asString(manifest.author),
        category: asString(manifest.category),
        tags: asStringArray(manifest.taxonomy),
      };
    });
    return await ctx.runMutation(internal.engineSyncInternal.reconcileModules, { instanceId, snapshots });
  },
};
