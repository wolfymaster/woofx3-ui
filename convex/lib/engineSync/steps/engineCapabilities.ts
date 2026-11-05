import { parseEngineCapabilities } from "@woofx3/api/capabilities";
import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * engineCapabilitiesStep — stores what the engine advertises, first in every
 * run, so the steps after it and the dashboard's capability gates read the
 * stored answer. A registration starts a run, so an engine that restarted
 * (perhaps on a new version) or was replaced reports again here.
 */
export const engineCapabilitiesStep: SyncStep = {
  name: "engineCapabilities",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const { capabilities } = parseEngineCapabilities(await newApi().getEngineCapabilities());
    await ctx.runMutation(internal.engineCapabilities.store, { instanceId, capabilities, fetchedAt: Date.now() });
    return { itemsProcessed: capabilities.length };
  },
};
