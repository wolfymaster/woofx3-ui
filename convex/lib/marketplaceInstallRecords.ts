import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { MarketplaceProvenance } from "./marketplaceInstallIdentity";

/** What Convex recorded for the install of `moduleKey`, or null when it started none. */
export async function recordedProvenance(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  moduleKey: string | undefined
): Promise<MarketplaceProvenance | null> {
  if (!moduleKey) {
    return null;
  }
  const record = await ctx.db
    .query("marketplaceInstalls")
    .withIndex("by_instance_module_key", (q) => q.eq("instanceId", instanceId).eq("moduleKey", moduleKey))
    .unique();
  if (!record) {
    return null;
  }
  return { marketplaceListingId: record.listingId, marketplaceEdition: record.edition };
}

/**
 * Records which listing and edition the install of `moduleKey` is for, and
 * applies it to the module's row if the engine has already reported the
 * install. Replaces any record for another build of the same manifest id: a
 * row only ever reads the record for its current key.
 */
export async function recordMarketplaceInstall(
  ctx: MutationCtx,
  {
    instanceId,
    moduleKey,
    listingId,
    edition,
  }: { instanceId: Id<"instances">; moduleKey: string; listingId: string; edition?: number }
): Promise<void> {
  const manifestId = moduleKey.split(":")[0];
  if (!manifestId) {
    throw new Error(`Install key "${moduleKey}" has no manifest id`);
  }
  // Keys of one manifest id sort together: `{id}:` up to, not including,
  // `{id};` (";" follows ":").
  const sameModule = await ctx.db
    .query("marketplaceInstalls")
    .withIndex("by_instance_module_key", (q) =>
      q.eq("instanceId", instanceId).gte("moduleKey", `${manifestId}:`).lt("moduleKey", `${manifestId};`)
    )
    .take(100);
  for (const record of sameModule) {
    await ctx.db.delete(record._id);
  }
  await ctx.db.insert("marketplaceInstalls", { instanceId, moduleKey, listingId, edition });

  const rows = await ctx.db
    .query("moduleRepository")
    .withIndex("by_instance_module_key", (q) => q.eq("instanceId", instanceId).eq("moduleKey", moduleKey))
    .take(10);
  for (const row of rows) {
    await ctx.db.patch(row._id, { marketplaceListingId: listingId, marketplaceEdition: edition });
  }
}
