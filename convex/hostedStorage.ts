import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { accountEntitlements } from "./lib/entitlementAccess";
import {
  type HostedStorageLimits,
  hostedStorageLimits,
  hostedUploadKind,
  hostedUploadRefusal,
} from "./lib/hostedStorage";

// Hosted storage limits are checked against the engine's own total of its
// resources plus reservations: bytes promised to grants the engine may not
// have recorded yet. An upload action reads the engine's total, then reserves
// here. A reservation counts until it is released, and for a reservation
// released after the caller read the engine's total, until that total could
// include it. Released means the engine's resource row for the grant exists
// (it is created before the grant is returned), so anything released before
// the read is already in the engine's total and is not counted twice.
// Reserving is a mutation, and Convex runs mutations serializably, so two
// uploads racing for the last bytes cannot both see them free.

/** Reservations counted against one check; more in flight than this is refused rather than read unbounded. */
const MAX_OUTSTANDING_RESERVATIONS = 200;
/** A reservation its action never released (it crashed) is released by the sweep after this. */
const ABANDONED_AFTER_MS = 10 * 60 * 1000;
/** Released reservations are kept this long: longer than any upload action's read of the engine's total. */
const RELEASED_KEPT_MS = 60 * 60 * 1000;

export interface HostedStorageContext {
  hosting: "managed" | "external" | undefined;
  limits: HostedStorageLimits;
}

async function loadLimits(ctx: QueryCtx, instanceId: Id<"instances">): Promise<HostedStorageContext> {
  const instance = await ctx.db.get(instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }
  return {
    hosting: instance.hosting,
    limits: hostedStorageLimits(await accountEntitlements(ctx, instance.accountId), instance.hostedStorageLimits),
  };
}

/** Reserved bytes the engine's total, read at `readAt`, may not include; null when too many are in flight. */
async function outstandingBytes(ctx: QueryCtx, instanceId: Id<"instances">, readAt: number): Promise<number | null> {
  const unreleased = await ctx.db
    .query("hostedStorageReservations")
    .withIndex("by_instance_released", (q) => q.eq("instanceId", instanceId).eq("releasedAt", undefined))
    .take(MAX_OUTSTANDING_RESERVATIONS + 1);
  const releasedSinceRead = await ctx.db
    .query("hostedStorageReservations")
    .withIndex("by_instance_released", (q) => q.eq("instanceId", instanceId).gte("releasedAt", readAt))
    .take(MAX_OUTSTANDING_RESERVATIONS + 1);
  const rows = [...unreleased, ...releasedSinceRead];
  if (rows.length > MAX_OUTSTANDING_RESERVATIONS) {
    return null;
  }
  return rows.reduce((sum, row) => sum + row.bytes, 0);
}

export const context = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<HostedStorageContext> => {
    return loadLimits(ctx, instanceId);
  },
});

/** What counts against the limit now, for the usage meter: the engine's total plus anything it may not include yet. */
export const usedBytes = internalQuery({
  args: { instanceId: v.id("instances"), engineBytes: v.number(), readAt: v.number() },
  handler: async (ctx, { instanceId, engineBytes, readAt }): Promise<number> => {
    const outstanding = await outstandingBytes(ctx, instanceId, readAt);
    return engineBytes + (outstanding ?? 0);
  },
});

/**
 * Hold `size` bytes for one upload grant, or say why it is refused. The
 * entitlements are read here rather than passed in, so a plan change between
 * the action's start and this check still applies.
 */
export const reserve = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineBytes: v.number(),
    readAt: v.number(),
    size: v.number(),
    kind: hostedUploadKind,
  },
  handler: async (
    ctx,
    { instanceId, engineBytes, readAt, size, kind }
  ): Promise<{ reservationId: Id<"hostedStorageReservations"> } | { refusal: string }> => {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error(`Upload size must be a whole number of bytes above 0; got ${size}`);
    }
    if (!Number.isSafeInteger(engineBytes) || engineBytes < 0) {
      throw new Error(`Engine usage must be a whole number of bytes; got ${engineBytes}`);
    }
    const { limits } = await loadLimits(ctx, instanceId);
    const outstanding = await outstandingBytes(ctx, instanceId, readAt);
    if (outstanding === null) {
      return { refusal: "Too many uploads are in progress. Wait for them to finish, then try again." };
    }
    const refusal = hostedUploadRefusal(limits, engineBytes + outstanding, size, kind);
    if (refusal !== null) {
      return { refusal };
    }
    const reservationId = await ctx.db.insert("hostedStorageReservations", {
      instanceId,
      bytes: size,
      createdAt: Date.now(),
    });
    return { reservationId };
  },
});

/** The grant was issued (its resource row exists) or failed; either way the engine's total now speaks for it. */
export const release = internalMutation({
  args: { reservationId: v.id("hostedStorageReservations") },
  handler: async (ctx, { reservationId }) => {
    const reservation = await ctx.db.get(reservationId);
    if (!reservation || reservation.releasedAt !== undefined) {
      return;
    }
    await ctx.db.patch(reservationId, { releasedAt: Date.now() });
  },
});

/**
 * Releases reservations whose action died before releasing them, and deletes
 * released ones no read can still need. Reads only rows past those bounds.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const abandoned = await ctx.db
      .query("hostedStorageReservations")
      .withIndex("by_released_created", (q) => q.eq("releasedAt", undefined).lt("createdAt", now - ABANDONED_AFTER_MS))
      .take(500);
    for (const row of abandoned) {
      await ctx.db.patch(row._id, { releasedAt: now });
    }
    const expired = await ctx.db
      .query("hostedStorageReservations")
      .withIndex("by_released_created", (q) => q.gte("releasedAt", 0).lt("releasedAt", now - RELEASED_KEPT_MS))
      .take(500);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
  },
});
