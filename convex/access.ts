import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import type { LifecycleReason } from "./lib/billingLifecycle";
import { orgCan, orgRoleOf } from "./lib/orgRoles";
import { subscriptionFor } from "./lib/subscriptions";

// Bounds the read of a user's engine memberships; a user is on a handful.
const MAX_MEMBERSHIPS = 100;

/**
 * Where the dashboard sends a signed-in user. The dashboard needs an engine:
 * a user with no registered engine is sent to create one, and a hosted engine
 * whose org is suspended is locked to a page that says so.
 */
export type DashboardEntry =
  | { kind: "engine"; instanceId: Id<"instances"> }
  | { kind: "createEngine"; accountId: Id<"accounts"> | null }
  | {
      kind: "suspended";
      instanceId: Id<"instances">;
      reason: LifecycleReason;
      canManageBilling: boolean;
      ownerName: string | null;
    };

/**
 * The engine to open: the selected one, else the user's default, else the one
 * viewed last (created last when none was ever viewed). Each must still be a
 * registered engine the user is a member of.
 */
function chooseEngine(
  engines: Doc<"instances">[],
  selectedId: Id<"instances"> | null,
  defaultId: Id<"instances"> | undefined
): Doc<"instances"> | null {
  const byId = (id: Id<"instances"> | null | undefined) => engines.find((engine) => engine._id === id);
  const latest = [...engines].sort(
    (a, b) => (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0) || b.createdAt - a.createdAt
  )[0];
  return byId(selectedId) ?? byId(defaultId) ?? latest ?? null;
}

async function registeredEnginesOf(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"instances">[]> {
  const memberships = await ctx.db
    .query("instanceMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_MEMBERSHIPS);
  const engines = await Promise.all(memberships.map((membership) => ctx.db.get(membership.instanceId)));
  // Only a finished handshake (`clientId`) makes an engine usable; a managed
  // one still being built, or a failed registration, is onboarding's to finish.
  return engines.filter((engine): engine is Doc<"instances"> => engine !== null && Boolean(engine.clientId));
}

/**
 * Locked while the org's subscription is suspended. Only hosted engines are
 * billed, and an org with no subscription row yet (before the subscription
 * migration) keeps its engine.
 */
async function suspendedEntry(
  ctx: QueryCtx,
  engine: Doc<"instances">,
  userId: Id<"users">
): Promise<DashboardEntry | null> {
  if (engine.hosting !== "managed") {
    return null;
  }
  const subscription = await subscriptionFor(ctx, engine.accountId);
  if (subscription === null || subscription.state !== "suspended") {
    return null;
  }
  if (subscription.stateReason === undefined) {
    throw new Error(`subscription ${subscription._id} is suspended with no reason`);
  }
  const account = await ctx.db.get(engine.accountId);
  if (account === null) {
    throw new Error(`instance ${engine._id} belongs to missing account ${engine.accountId}`);
  }
  const owner = await ctx.db.get(account.ownerId);
  return {
    kind: "suspended",
    instanceId: engine._id,
    reason: subscription.stateReason,
    canManageBilling: orgCan(await orgRoleOf(ctx, account, userId), "manageBilling"),
    ownerName: owner?.name ?? null,
  };
}

/**
 * `selectedInstanceId` is the engine the dashboard has selected, so switching
 * engines re-checks the lock for the new one. Null when unauthenticated.
 */
export const entry = query({
  args: { selectedInstanceId: v.union(v.id("instances"), v.null()) },
  handler: async (ctx, { selectedInstanceId }): Promise<DashboardEntry | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const engine = chooseEngine(
      await registeredEnginesOf(ctx, userId),
      selectedInstanceId,
      settings?.defaultInstanceId
    );
    if (engine === null) {
      const owned = await ctx.db
        .query("accounts")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .first();
      return { kind: "createEngine", accountId: owned?._id ?? null };
    }
    return (await suspendedEntry(ctx, engine, userId)) ?? { kind: "engine", instanceId: engine._id };
  },
});
