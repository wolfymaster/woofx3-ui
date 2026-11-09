import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, runMigration } from "../lib/convexTest.testing";
import { subscriptionFor } from "../lib/subscriptions";

type Backend = ReturnType<typeof newBackend>;

interface Orgs {
  comped: Id<"accounts">;
  managed: Id<"accounts">;
  selfHosted: Id<"accounts">;
}

/** A managed org on a Pro comp, a managed org with no comp, and a self-hosted org. */
async function seedOrgs(t: Backend): Promise<Orgs> {
  return t.run(async (ctx) => {
    const org = async (name: string, managed: boolean) => {
      const ownerId = await ctx.db.insert("users", { name: `${name} owner` });
      const accountId = await ctx.db.insert("accounts", { name, ownerId, createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
      const instanceId = await ctx.db.insert("instances", {
        accountId,
        name,
        url: "",
        hosting: managed ? "managed" : undefined,
        createdAt: 1,
      });
      await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
      if (managed) {
        await ctx.db.insert("engineProvisioning", {
          instanceId,
          accountId,
          requestedBy: ownerId,
          slug: `slug-${name}`,
          status: "registered",
          steps: [],
          registrationToken: "token",
          registrationAttempts: 0,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      return accountId;
    };
    const comped = await org("comped", true);
    const managed = await org("managed", true);
    const selfHosted = await org("self-hosted", false);
    const plan = (key: "starter" | "pro") =>
      ctx.db.insert("plans", {
        key,
        name: key,
        features: [],
        limits: [],
        offered: true,
        isDefault: false,
        updatedAt: 1,
        updatedBy: "test",
      });
    await plan("starter");
    const pro = await plan("pro");
    await ctx.db.insert("accountPlans", {
      accountId: comped,
      planId: pro,
      addFeatures: [],
      removeFeatures: [],
      limits: [],
      updatedAt: 1,
      updatedBy: "test",
    });
    return { comped, managed, selfHosted };
  });
}

const M3 = internal.migrations.subscriptions.seedSubscriptions;
const M6 = internal.migrations.subscriptions.exemptionsFromPlanAssignments;

async function endState(t: Backend, orgs: Orgs) {
  return t.run(async (ctx) => {
    const row = async (accountId: Id<"accounts">) => {
      const sub = await subscriptionFor(ctx, accountId);
      return sub === null
        ? null
        : { state: sub.state, plan: sub.plan, origin: sub.origin, exemptUntil: sub.exemptUntil };
    };
    return { comped: await row(orgs.comped), managed: await row(orgs.managed), selfHosted: await row(orgs.selfHosted) };
  });
}

async function violations(t: Backend) {
  return (await t.action(internal.migrations.organizations.checkOrgInvariantsAll, {})).violations;
}

describe("subscription migrations in any order", () => {
  const orders = { "M6 then M3": [M6, M3], "M3 then M6": [M3, M6], "M3, M6, M3, M6": [M3, M6, M3, M6] };

  for (const [name, order] of Object.entries(orders)) {
    test(`${name} exempts the comped org and trials the other managed one`, async () => {
      const t = newBackend();
      const orgs = await seedOrgs(t);
      for (const migration of order) {
        await runMigration(t, migration);
      }
      expect(await endState(t, orgs)).toEqual({
        comped: { state: "exempt", plan: "pro", origin: "migration", exemptUntil: undefined },
        managed: { state: "trialing", plan: "starter", origin: "migration", exemptUntil: undefined },
        selfHosted: null,
      });
      expect(await violations(t)).toEqual([]);
    });
  }

  test("M6 leaves a trial someone has since paid for alone", async () => {
    const t = newBackend();
    const orgs = await seedOrgs(t);
    await runMigration(t, M3);
    await t.run(async (ctx) => {
      const sub = await subscriptionFor(ctx, orgs.comped);
      if (sub === null) {
        throw new Error("seed: comped org has no subscription");
      }
      await ctx.db.patch(sub._id, { providerSubscriptionId: "sub_paid" });
    });
    await runMigration(t, M6);
    expect((await endState(t, orgs)).comped?.state).toBe("trialing");
  });

  const STATES = ["trialing", "active", "past_due", "suspended", "exempt"] as const;
  const ORIGINS = ["migration", "signup", "operator"] as const;

  for (const origin of ORIGINS) {
    for (const state of STATES) {
      for (const provider of [undefined, "sub_paid"]) {
        const converts = state === "trialing" && provider === undefined;
        test(`M6 ${converts ? "converts" : "leaves"} a ${origin} ${state} row ${provider ? "with" : "without"} a provider subscription`, async () => {
          const t = newBackend();
          const orgs = await seedOrgs(t);
          await t.run(async (ctx) => {
            await ctx.db.insert("subscriptions", {
              accountId: orgs.comped,
              plan: "starter",
              state,
              origin,
              providerSubscriptionId: provider,
              stateSince: 1,
              addOns: [],
              updatedAt: 1,
              updatedBy: "test",
            });
          });
          await runMigration(t, M6);
          const after = (await endState(t, orgs)).comped;
          expect(after?.state).toBe(converts ? "exempt" : state);
          if (!converts) {
            expect(after?.origin).toBe(origin);
          }
          const again = JSON.stringify(await endState(t, orgs));
          await runMigration(t, M6);
          expect(JSON.stringify(await endState(t, orgs))).toBe(again);
        });
      }
    }
  }

  test("M5 reports a comped org that is not exempt", async () => {
    const t = newBackend();
    const orgs = await seedOrgs(t);
    await runMigration(t, M3);
    expect(await violations(t)).toEqual([
      { invariant: "subscription", accountId: orgs.comped, detail: "comped_not_exempt" },
    ]);
  });
});
