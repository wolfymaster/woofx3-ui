import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalMutation, query } from "./_generated/server";
import { type EngineObservation, engineReportPatch } from "./lib/engineReport";
import { engineBelowMinimum, MIN_SUPPORTED_ENGINE_VERSION } from "./lib/engineVersion";
import { isInstanceMember } from "./lib/teamAccess";
import { logger } from "./logger";

/** Stores what an engine answered; see lib/engineReport.ts. */
export const record = internalMutation({
  args: {
    instanceId: v.id("instances"),
    version: v.optional(v.union(v.string(), v.null())),
    capabilityIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { instanceId, version, capabilityIds }): Promise<void> => {
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return;
    }
    const patch = engineReportPatch(instance, { version, capabilityIds }, Date.now());
    if (patch !== null) {
      await ctx.db.patch(instanceId, patch);
    }
  },
});

/**
 * Records an engine's answer from an action that has already used it. A
 * failure is logged and swallowed: the record is for operators, and must
 * never fail the call the member made.
 */
export async function recordEngineReport(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  observed: EngineObservation
): Promise<void> {
  try {
    await ctx.runMutation(internal.engineReports.record, {
      instanceId,
      ...(observed.version === undefined ? {} : { version: observed.version }),
      ...(observed.capabilityIds === undefined ? {} : { capabilityIds: [...observed.capabilityIds] }),
    });
  } catch (error) {
    logger.warn("engine report: could not record", {
      instanceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface EngineVersionStatus {
  /** The release the engine last reported, as it reported it, or null if none is known. */
  version: string | null;
  minimumSupportedVersion: string | null;
  /** False when either version is unset or outside the release order; see engineBelowMinimum. */
  belowMinimum: boolean;
}

/**
 * Whether the instance's engine is older than this dashboard supports. Null
 * for a non-member. Nothing shows this yet; it is here for a notice to read.
 */
export const versionStatus = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<EngineVersionStatus | null> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return null;
    }
    return {
      version: instance.engineVersion ?? null,
      minimumSupportedVersion: MIN_SUPPORTED_ENGINE_VERSION,
      belowMinimum: engineBelowMinimum(instance),
    };
  },
});
