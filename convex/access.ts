import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { isUsable } from "./lib/entitlements";
import { engineBuildStalled } from "./lib/firstRun";
import type { LifecycleReason } from "./lib/organization";
import { billingFor } from "./lib/orgBilling";
import { orgCan, orgRoleOf } from "./lib/orgRoles";
import { getInstanceMembership } from "./lib/teamAccess";

// Bounds the read of a user's engine memberships; a user is on a handful.
const MAX_MEMBERSHIPS = 100;

/**
 * Where the dashboard sends a signed-in user. The dashboard needs an engine:
 * a user with no registered engine is sent to create one, and a hosted engine
 * whose org is suspended is locked to a page that says so. A managed engine
 * that is still being built is enterable too, with `starting` telling the
 * dashboard to show the shell and a waiting state instead of engine panels.
 */
export type DashboardEntry =
  | { kind: "engine"; instanceId: Id<"instances">; starting: boolean }
  | { kind: "createEngine"; accountId: Id<"accounts"> | null }
  | {
      kind: "suspended";
      instanceId: Id<"instances">;
      reason: LifecycleReason;
      canManageBilling: boolean;
      ownerName: string | null;
    };

/** A membership the dashboard can open, and whether its engine has finished registering. */
interface EnterableEngine {
  engine: Doc<"instances">;
  starting: boolean;
}

/** The statuses a managed engine passes through while woofx3 builds and registers it. */
const BUILDING_STATUSES: ReadonlySet<Doc<"engineProvisioning">["status"]> = new Set([
  "requested",
  "provisioning",
  "ready",
  "registering",
]);

function byNewest(a: EnterableEngine, b: EnterableEngine): number {
  return b.engine.createdAt - a.engine.createdAt;
}

/**
 * The engine to open: the selected one, else the user's default, else the
 * newest registered one, else the newest still starting. A registered engine
 * wins the fallback so an older working one is not hidden behind a new one
 * that is still coming up.
 */
function chooseEngine(
  engines: EnterableEngine[],
  selectedId: Id<"instances"> | null,
  defaultId: Id<"instances"> | undefined
): EnterableEngine | null {
  const byId = (id: Id<"instances"> | null | undefined) => engines.find((candidate) => candidate.engine._id === id);
  const selected = byId(selectedId) ?? byId(defaultId);
  if (selected) {
    return selected;
  }
  const registered = engines.filter((candidate) => !candidate.starting).sort(byNewest)[0];
  return registered ?? [...engines].sort(byNewest)[0] ?? null;
}

async function enterableEnginesOf(ctx: QueryCtx, userId: Id<"users">, now: number): Promise<EnterableEngine[]> {
  const memberships = await ctx.db
    .query("instanceMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_MEMBERSHIPS);
  const engines = await Promise.all(memberships.map((membership) => ctx.db.get(membership.instanceId)));
  const enterable: EnterableEngine[] = [];
  for (const engine of engines) {
    if (engine === null) {
      continue;
    }
    if (engine.clientId) {
      enterable.push({ engine, starting: false });
      continue;
    }
    // Only a managed engine woofx3 is actively building is worth opening
    // early; a failed, torn-down or self-hosted one is onboarding's to finish.
    if (engine.hosting !== "managed") {
      continue;
    }
    const provisioning = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", engine._id))
      .first();
    if (provisioning === null || !BUILDING_STATUSES.has(provisioning.status)) {
      continue;
    }
    if (engineBuildStalled({ provisioning, managedEngine: true, completedAt: null, now })) {
      continue;
    }
    enterable.push({ engine, starting: true });
  }
  return enterable;
}

/**
 * Locked while the org's billing projection is suspended. Only hosted engines are billed, and an org with no billing yet
 * keeps its engine.
 */
async function suspendedEntry(
  ctx: QueryCtx,
  engine: Doc<"instances">,
  userId: Id<"users">
): Promise<DashboardEntry | null> {
  if (engine.hosting !== "managed") {
    return null;
  }
  const subscription = (await billingFor(ctx, engine.accountId))?.summary ?? null;
  if (subscription === null || subscription.state !== "suspended") {
    return null;
  }
  if (subscription.stateReason === null) {
    throw new Error(`org ${engine.accountId} is suspended with no reason`);
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
      await enterableEnginesOf(ctx, userId, Date.now()),
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
    return (
      (await suspendedEntry(ctx, engine.engine, userId)) ?? {
        kind: "engine",
        instanceId: engine.engine._id,
        starting: engine.starting,
      }
    );
  },
});

/**
 * What onboarding tells the owner about paying for a hosted engine:
 * - trial: the org is on its free trial, so the engine just gets built
 * - choosePlan: the trial is used up and its billing isn't usable, so no
 *   engine is built until the owner picks a plan in the portal
 */
export type PlanPrompt = { kind: "trial"; endsAt: number } | { kind: "choosePlan" };

/**
 * Null for anyone but the org's owner, for a self-hosted engine, and when
 * nothing needs saying: an invitee or a self-hosted owner never sees a trial
 * or a plan prompt.
 */
export const planPrompt = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<PlanPrompt | null> => {
    const userId = await getAuthUserId(ctx);
    const instance = await ctx.db.get(instanceId);
    if (userId === null || instance === null || instance.hosting !== "managed") {
      return null;
    }
    if ((await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    const account = await ctx.db.get(instance.accountId);
    if (account === null) {
      throw new Error(`instance ${instanceId} belongs to missing account ${instance.accountId}`);
    }
    if (!orgCan(await orgRoleOf(ctx, account, userId), "manageBilling")) {
      return null;
    }
    const subscription = (await billingFor(ctx, account._id))?.summary ?? null;
    if (subscription === null) {
      return null;
    }
    if (subscription.state === "trialing") {
      if (subscription.nextBillingAt === null) {
        throw new Error(`account ${account._id} is trialing with no trial end`);
      }
      return { kind: "trial", endsAt: subscription.nextBillingAt };
    }
    return isUsable(subscription) ? null : { kind: "choosePlan" };
  },
});
