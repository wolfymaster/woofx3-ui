import { parseEngineCapabilities } from "@woofx3/api/capabilities";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation } from "./_generated/server";
import {
  ENGINE_EVENTS_INGEST_URL_ENV,
  type EventQueueUrls,
  eventQueueUrlsFromEnv,
  type MoveOutcome,
  moveEngineToEventQueue,
} from "./lib/engineEvents/move";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { isMaintenanceConfigured, putEngineEventSource } from "./lib/maintenanceClient";
import { generateOpaqueToken } from "./lib/oauthHandoff";
import { logger } from "./logger";

// Moving engines from the webhook route onto the maintenance event queue, and
// back for a rollback. See lib/engineEvents/move.ts for the order of a move.

/** Whether this deployment has an event queue to move engines onto. */
export function isEventQueueConfigured(): boolean {
  return isMaintenanceConfigured() && Boolean(process.env[ENGINE_EVENTS_INGEST_URL_ENV]);
}

export type InstanceMoveOutcome = MoveOutcome | "already_moved" | "not_registered";

export const recordEventsTokenHash = internalMutation({
  args: { instanceId: v.id("instances"), tokenSha256: v.string() },
  handler: async (ctx, { instanceId, tokenSha256 }) => {
    await ctx.db.patch(instanceId, { eventsTokenHash: tokenSha256 });
  },
});

export const recordEventsTargetSet = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    await ctx.db.patch(instanceId, { eventsTargetSetAt: Date.now() });
  },
});

/**
 * Keeps eventsTokenHash: events already queued under it still apply as the
 * queue drains, and the next move replaces it.
 */
export const recordEventsTargetCleared = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    await ctx.db.patch(instanceId, { eventsTargetSetAt: undefined });
  },
});

/**
 * Moves one instance's engine onto the event queue, unless it already moved
 * or is not registered. Safe to run again: a move that stopped part way mints
 * a new token and replaces whatever the last attempt set.
 */
export async function moveInstanceToEventQueue(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  urls: EventQueueUrls
): Promise<InstanceMoveOutcome> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance?.clientId || !instance.clientSecret) {
    return "not_registered";
  }
  if (instance.eventsTargetSetAt !== undefined) {
    return "already_moved";
  }
  const { url, clientId, clientSecret } = instance;
  const engine = () => createEngineRpcSession<EngineApi>(url, clientId, clientSecret);
  const outcome = await moveEngineToEventQueue(
    {
      engineCapabilities: async () => parseEngineCapabilities(await engine().getEngineCapabilities()).capabilities,
      putSource: async (source) => {
        await putEngineEventSource(instanceId, source);
      },
      recordTokenHash: async (tokenSha256) => {
        await ctx.runMutation(internal.engineEventQueue.recordEventsTokenHash, { instanceId, tokenSha256 });
      },
      setEventsTarget: async (target) => {
        await engine().setEventsTarget(target);
      },
      recordTargetSet: async () => {
        await ctx.runMutation(internal.engineEventQueue.recordEventsTargetSet, { instanceId });
      },
    },
    urls,
    generateOpaqueToken()
  );
  logger.info("event queue: move", { instanceId, outcome });
  return outcome;
}

/** Throws when this deployment has no event queue configured. */
export const moveToQueue = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<InstanceMoveOutcome> => {
    return moveInstanceToEventQueue(ctx, instanceId, eventQueueUrlsFromEnv());
  },
});

/**
 * Rollback: the engine goes back to posting its events to the webhook route.
 * Events it already queued still drain from the queue.
 */
export const clearEventsTarget = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<void> => {
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    await createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret).setEventsTarget(
      null
    );
    await ctx.runMutation(internal.engineEventQueue.recordEventsTargetCleared, { instanceId });
  },
});
