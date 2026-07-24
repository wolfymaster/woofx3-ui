import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * functionsStep — full-snapshot reconciliation of module-exposed functions
 * (the catalog backing "function"-type chat commands, see
 * docs/services/commands-ui.md in the woofx3 engine repo).
 *
 * Pulls the engine's `listAvailableFunctions()` and forwards it to
 * `internal.engineSyncInternal.reconcileFunctions`. This exists alongside the
 * MODULE_FUNCTION_REGISTERED/_DEREGISTERED webhooks (convex/moduleFunctions.ts)
 * rather than replacing them: the webhooks give near-instant updates when a
 * module (re)registers, while this step is the self-healing fallback for
 * modules that were installed before that webhook path existed, or whose
 * registration webhook was missed.
 *
 * Both `f.qualifiedName` AND `f.moduleId` from this RPC are intentionally
 * dropped, not forwarded — `qualifiedName` is display-name-based and doesn't
 * resolve in barkloader's ModuleRegistry, and `f.moduleId` is actually the
 * module's database row UUID (commands.ts's listAvailableFunctions sets it
 * from `m.id`), not the manifest-declared module id barkloader's registry
 * key actually uses. reconcileFunctions rebuilds the canonical id from the
 * module's `moduleKey` (already stored per-module in moduleRepository,
 * looked up by `moduleName`) instead — moduleKey's first colon segment is
 * built from that same manifest id at install time. See
 * docs/services/commands-ui.md in the woofx3 engine repo.
 */
export const functionsStep: SyncStep = {
  name: "functions",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const fns = (await newApi().listAvailableFunctions()) ?? [];
    const safe = fns.map((f) => ({
      engineFunctionId: f.id,
      moduleName: f.moduleName,
      manifestId: f.manifestId,
      name: f.name,
      runtime: f.runtime,
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileFunctions, {
      instanceId,
      snapshots: safe,
    });
  },
};
