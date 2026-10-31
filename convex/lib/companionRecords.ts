import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { companionsReplacedBy, MAX_COMPANION_ROWS_PER_INSTANCE } from "./companionCodes";
import { MAX_ENDPOINT_ROWS_PER_COMPANION, resyncRelayIfBridging, scheduleRelaySync } from "./companionEndpoints";

/** Presence rows hold one per companion; the bound only guards against a duplicate slipping in. */
const MAX_PRESENCE_ROWS_PER_COMPANION = 10;

export async function deleteCompanionPresence(ctx: MutationCtx, companionId: Id<"companions">): Promise<void> {
  const rows = await ctx.db
    .query("companionPresence")
    .withIndex("by_companion", (q) => q.eq("companionId", companionId))
    .take(MAX_PRESENCE_ROWS_PER_COMPANION);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

/**
 * Deleting the row is the revocation: the companion's token stops
 * authenticating at once, and it can no longer mint relay credentials. Its
 * endpoint rows go with it, since they describe what that companion does, and
 * the engine is told at once to stop dialing its bridge. Revoking, unpairing
 * and replacing a companion all come through here.
 */
export async function deleteCompanion(ctx: MutationCtx, companionId: Id<"companions">): Promise<void> {
  const companion = await ctx.db.get(companionId);
  if (!companion) {
    return;
  }
  await deleteCompanionPresence(ctx, companionId);
  const endpoints = await ctx.db
    .query("companionEndpoints")
    .withIndex("by_companion", (q) => q.eq("companionId", companionId))
    .take(MAX_ENDPOINT_ROWS_PER_COMPANION);
  for (const row of endpoints) {
    await ctx.db.delete(row._id);
  }
  await ctx.db.delete(companionId);
  if (endpoints.some((row) => row.enabled)) {
    await scheduleRelaySync(ctx, companion.instanceId);
  }
}

/** How the companion names the person who approved it, so the person at the PC can recognise them. */
export function approverDisplayName(user: Doc<"users"> | null): string {
  return user?.name ?? user?.email ?? "an instance admin";
}

/** The instance's companion rows; at most one is expected, see MAX_COMPANION_ROWS_PER_INSTANCE. */
export async function companionsOf(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Doc<"companions">[]> {
  return ctx.db
    .query("companions")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(MAX_COMPANION_ROWS_PER_INSTANCE);
}

/**
 * What a signed-in admin is shown of a companion that pairing another device
 * would replace. Never its token hash or installation id.
 */
export interface ReplacedCompanion {
  deviceName: string;
  pairedAt: number;
  lastSeenAt: number | null;
}

export async function describeReplacedCompanion(
  ctx: QueryCtx,
  companion: Doc<"companions">
): Promise<ReplacedCompanion> {
  const presence = await ctx.db
    .query("companionPresence")
    .withIndex("by_companion", (q) => q.eq("companionId", companion._id))
    .first();
  return {
    deviceName: companion.deviceName,
    pairedAt: companion.pairedAt,
    lastSeenAt: presence?.lastSeenAt ?? null,
  };
}

/** A companion's credential as a pairing records it. `confirmedAt` is absent until the person at the PC confirms. */
export interface CompanionCredential {
  instanceId: Id<"instances">;
  installationId: string;
  tokenHash: string;
  deviceName: string;
  companionVersion: string;
  pairedBy: Id<"users">;
  pairedAt: number;
  confirmedAt: number | undefined;
}

/**
 * Makes `installationId` the instance's one companion, holding the
 * credential's token hash. An instance has at most one companion: rows from
 * other installations are deleted, and their `companions:self`
 * subscriptions turning null unpair them. The same installation pairing
 * again keeps its companion id (and so its endpoint rows) and gets the new
 * token. Throws when another companion row already holds the token hash.
 */
export async function writeCompanionCredential(
  ctx: MutationCtx,
  credential: CompanionCredential
): Promise<Id<"companions">> {
  const { instanceId, installationId, ...fields } = credential;
  const tokenHolder = await ctx.db
    .query("companions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", credential.tokenHash))
    .first();
  const existing = await ctx.db
    .query("companions")
    .withIndex("by_instance_installation", (q) => q.eq("instanceId", instanceId).eq("installationId", installationId))
    .first();
  if (tokenHolder && tokenHolder._id !== existing?._id) {
    throw new ConvexError("This companion's token is already in use. Start pairing again from the companion.");
  }
  for (const replaced of companionsReplacedBy(await companionsOf(ctx, instanceId), installationId)) {
    await deleteCompanion(ctx, replaced._id);
  }
  if (!existing) {
    return ctx.db.insert("companions", { instanceId, installationId, ...fields });
  }
  await ctx.db.patch(existing._id, fields);
  await deleteCompanionPresence(ctx, existing._id);
  // An unconfirmed token bridges nothing until the person at the PC confirms;
  // a confirmed one bridges under its new token.
  await resyncRelayIfBridging(ctx, instanceId);
  return existing._id;
}
