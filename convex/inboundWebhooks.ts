import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, query } from "./_generated/server";
import { shouldRecordDelivery } from "./lib/inboundWebhookDelivery";
import { getInstanceMembership } from "./lib/teamAccess";
import { type WebhookEndpointKey, webhookEndpointKey } from "./lib/webhookEndpointKey";

type EndpointKey = { instanceId: Id<"instances">; triggerKey: string };

function findEndpoint(ctx: MutationCtx, { instanceId, triggerKey }: EndpointKey) {
  return ctx.db
    .query("webhookEndpoints")
    .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerKey", triggerKey))
    .first();
}

/**
 * Give a webhook trigger its public URL, or re-enable the one it already has.
 * The endpointId is minted once and never changes, so re-registering after a
 * deregister, archive, forced reinstall or rollback keeps the same URL.
 */
export async function provisionEndpoint(
  ctx: MutationCtx,
  args: { instanceId: Id<"instances"> } & WebhookEndpointKey
): Promise<void> {
  const existing = await findEndpoint(ctx, args);
  if (existing) {
    if (!existing.isEnabled) {
      await ctx.db.patch(existing._id, { isEnabled: true });
    }
    return;
  }
  await ctx.db.insert("webhookEndpoints", {
    instanceId: args.instanceId,
    endpointId: crypto.randomUUID(),
    triggerKey: args.triggerKey,
    modulePrefix: args.modulePrefix,
    triggerManifestId: args.triggerManifestId,
    isEnabled: true,
    createdAt: Date.now(),
  });
}

/** Stop answering on a trigger's URL without giving the URL up. */
export async function disableEndpoint(ctx: MutationCtx, key: EndpointKey): Promise<void> {
  const existing = await findEndpoint(ctx, key);
  if (existing?.isEnabled) {
    await ctx.db.patch(existing._id, { isEnabled: false });
  }
}

/** Delete a module's endpoints on one instance. Only the module cascade calls this. */
export async function removeEndpointsForModule(
  ctx: MutationCtx,
  { instanceId, modulePrefix }: { instanceId: Id<"instances">; modulePrefix: string }
): Promise<void> {
  const rows = await ctx.db
    .query("webhookEndpoints")
    .withIndex("by_instance_module", (q) => q.eq("instanceId", instanceId).eq("modulePrefix", modulePrefix))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

/**
 * Bring an instance's endpoints in line with the engine's full trigger list:
 * provision every webhook trigger in it, and disable any endpoint whose
 * trigger is gone. Never deletes — the trigger may return in a later version.
 * The repair path for registration callbacks that were missed or arrived out
 * of order.
 */
export async function reconcileEndpoints(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  triggers: { transport?: string; event?: string; projectionKey?: string }[]
): Promise<void> {
  const live = new Set<string>();
  for (const trigger of triggers) {
    const key = webhookEndpointKey(trigger);
    if (!key) {
      continue;
    }
    live.add(key.triggerKey);
    await provisionEndpoint(ctx, { instanceId, ...key });
  }
  const rows = await ctx.db
    .query("webhookEndpoints")
    .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId))
    .collect();
  for (const row of rows) {
    if (row.isEnabled && !live.has(row.triggerKey)) {
      await ctx.db.patch(row._id, { isEnabled: false });
    }
  }
}

export const getByEndpointId = internalQuery({
  args: { endpointId: v.string() },
  handler: async (ctx, { endpointId }) => {
    return ctx.db
      .query("webhookEndpoints")
      .withIndex("by_endpoint_id", (q) => q.eq("endpointId", endpointId))
      .first();
  },
});

export const recordDelivery = internalMutation({
  args: {
    endpointId: v.id("webhookEndpoints"),
    status: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { endpointId, status, error }) => {
    const endpoint = await ctx.db.get(endpointId);
    if (!endpoint) {
      return;
    }
    const now = Date.now();
    if (!shouldRecordDelivery(endpoint, status, error, now)) {
      return;
    }
    await ctx.db.patch(endpointId, { lastDeliveryAt: now, lastStatus: status, lastError: error });
  },
});

/**
 * A module's live webhook endpoints on an instance, for its detail page.
 * `modulePrefix` is the module's manifest id.
 */
export const listForInstanceModule = query({
  args: { instanceId: v.id("instances"), modulePrefix: v.string() },
  handler: async (ctx, { instanceId, modulePrefix }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }
    const rows = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_instance_module", (q) => q.eq("instanceId", instanceId).eq("modulePrefix", modulePrefix))
      .collect();
    return rows
      .filter((row) => row.isEnabled)
      .map((row) => ({
        endpointId: row.endpointId,
        triggerManifestId: row.triggerManifestId,
        lastDeliveryAt: row.lastDeliveryAt,
        lastStatus: row.lastStatus,
        lastError: row.lastError,
      }));
  },
});
