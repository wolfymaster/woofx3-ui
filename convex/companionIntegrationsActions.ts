"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { type CompanionWrite, planCompanionWrites } from "./lib/localEndpoints";
import { requireEngineInstance } from "./moduleSettingsActions";

async function mayStillWrite(
  ctx: ActionCtx,
  args: { token: string; moduleId: string; endpointId: string },
  write: CompanionWrite
): Promise<boolean> {
  const current = await ctx.runQuery(internal.companionIntegrations.reportTarget, {
    token: args.token,
    moduleId: args.moduleId,
    endpointId: args.endpointId,
  });
  if (!current || (write.secret && !current.secretAllowed)) {
    return false;
  }
  return !current.provenance.some((row) => row.key === write.key && row.source === "manual");
}

/**
 * The companion fills in what it found for a local endpoint (the port OBS
 * listens on, and the password once the streamer opted in) as the module's
 * settings in the engine. An action because it writes to the engine; the
 * values pass through and only non-secret ones are kept, for comparison.
 */
export const reportDiscovered = action({
  args: {
    token: v.string(),
    moduleId: v.string(),
    endpointId: v.string(),
    values: v.object({ host: v.optional(v.string()), port: v.optional(v.number()), password: v.optional(v.string()) }),
  },
  returns: v.object({ written: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.companionIntegrations.reportTarget, {
      token: args.token,
      moduleId: args.moduleId,
      endpointId: args.endpointId,
    });
    if (!target) {
      throw new ConvexError("This companion cannot fill in that module's settings.");
    }
    await ctx.runMutation(internal.companionIntegrations.consumeReportBudget, { companionId: target.companionId });
    let writes: CompanionWrite[];
    try {
      writes = planCompanionWrites(target.endpoint, args.values, target.provenance, target.secretAllowed);
    } catch (error) {
      throw new ConvexError(error instanceof Error ? error.message : String(error));
    }
    if (writes.length === 0) {
      return { written: [] };
    }
    const engine = await requireEngineInstance(ctx, target.instanceId);
    const written: string[] = [];
    try {
      for (const write of writes) {
        // Each engine write is a round trip, during which the streamer may
        // save the key by hand or stop sharing the password, so check again
        // right before writing it.
        if (!(await mayStillWrite(ctx, args, write))) {
          continue;
        }
        // One session per call: an HTTP batch session is spent by its first call.
        await createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret).updateModuleSetting(
          args.moduleId,
          write.key,
          write.value
        );
        written.push(write.key);
      }
    } finally {
      // Record what did reach the engine, even when a later write failed.
      const recorded = writes.filter((write) => written.includes(write.key));
      if (recorded.length > 0) {
        await ctx.runMutation(internal.moduleSettingProvenance.recordCompanionWrites, {
          instanceId: target.instanceId,
          moduleId: args.moduleId,
          writes: recorded.map((write) => ({
            key: write.key,
            companionValue: write.secret ? undefined : write.value,
          })),
        });
      }
    }
    return { written };
  },
});
