import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_TTL_MS = 60_000; // 60 seconds

/**
 * Subscribe to a transient event by instanceId + correlationKey.
 * Returns the most recent event, or null if none exists yet.
 * Convex realtime pushes updates the moment an event is written.
 */
export const get = query({
  args: {
    instanceId: v.id("instances"),
    correlationKey: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("transientEvents")
      .withIndex("by_instance_correlation", (q) =>
        q.eq("instanceId", args.instanceId).eq("correlationKey", args.correlationKey),
      )
      .order("desc")
      .first();
  },
});

/**
 * Emit a transient event. The event is automatically scheduled for cleanup after TTL.
 */
export const emit = internalMutation({
  args: {
    instanceId: v.id("instances"),
    correlationKey: v.string(),
    type: v.string(),
    status: v.union(v.literal("progress"), v.literal("success"), v.literal("error")),
    message: v.optional(v.string()),
    data: v.optional(v.any()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ttl = args.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = Date.now() + ttl;

    const eventId = await ctx.db.insert("transientEvents", {
      instanceId: args.instanceId,
      correlationKey: args.correlationKey,
      type: args.type,
      status: args.status,
      message: args.message,
      data: args.data,
      expiresAt,
    });

    // Schedule cleanup
    await ctx.scheduler.runAt(expiresAt, internal.transientEvents.deleteEvent, { eventId });

    return eventId;
  },
});

/**
 * Delete a single transient event (used by scheduled cleanup).
 */
export const deleteEvent = internalMutation({
  args: { eventId: v.id("transientEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (event) {
      await ctx.db.delete(args.eventId);
    }
  },
});
