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
      qualifiedName: f.qualifiedName,
      runtime: f.runtime,
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileFunctions, {
      instanceId,
      snapshots: safe,
    });
  },
};
