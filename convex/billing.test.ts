import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BILLING_LIFECYCLE } from "./lib/billingLifecycle";
import { newBackend, runMigration } from "./lib/convexTest.testing";
import { applyTransition, subscriptionFor } from "./lib/subscriptions";

type Backend = ReturnType<typeof newBackend>;

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1);

async function seedOrg(t: Backend, name = "Org"): Promise<{ accountId: Id<"accounts">; ownerId: Id<"users"> }> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: `${name} owner` });
    const accountId = await ctx.db.insert("accounts", { name, ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    return { accountId, ownerId };
  });
}

async function startTrial(t: Backend, accountId: Id<"accounts">, now = T0) {
  return t.run(async (ctx) => {
    const result = await applyTransition(ctx, {
      accountId,
      event: { kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.trialDays },
      now,
      actor: "test",
      origin: "signup",
    });
    if (!result.ok) {
      throw new Error("trial start was illegal");
    }
    return result;
  });
}

async function subscription(t: Backend, accountId: Id<"accounts">) {
  return t.run((ctx) => subscriptionFor(ctx, accountId));
}

async function transitions(t: Backend, accountId: Id<"accounts">) {
  return t.run(async (ctx) =>
    (
      await ctx.db
        .query("subscriptionTransitions")
        .withIndex("by_account_at", (q) => q.eq("accountId", accountId))
        .collect()
    ).map((row) => [row.from ?? null, row.event, row.to])
  );
}

describe("applyTransition", () => {
  test("writes the row, its history and its warnings together", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    await startTrial(t, accountId);
    expect(await subscription(t, accountId)).toMatchObject({
      state: "trialing",
      plan: "starter",
      origin: "signup",
      nextBillingAt: T0 + 30 * DAY,
      nextCheckAt: T0 + 30 * DAY,
      addOns: [],
    });
    expect(await transitions(t, accountId)).toEqual([[null, "TrialStarted", "trialing"]]);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((job) => job.name === "billing:deliverWarning").length).toBe(3);
  });

  test("an illegal event changes nothing", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    await startTrial(t, accountId);
    const before = await subscription(t, accountId);
    const result = await t.run((ctx) =>
      applyTransition(ctx, { accountId, event: { kind: "SpinDownDue" }, now: T0, actor: "test", origin: "signup" })
    );
    expect(result).toMatchObject({ ok: false, error: { code: "illegal_transition", from: "trialing" } });
    expect(await subscription(t, accountId)).toEqual(before);
  });
});

describe("first managed engine", () => {
  test("creates no Convex trial, however often provisioning is retried", async () => {
    const t = newBackend();
    const { accountId, ownerId } = await seedOrg(t);
    const reserve = (n: number) =>
      t.mutation(internal.provisioningInternal.reserveManagedInstance, {
        accountId,
        userId: ownerId,
        slug: "org",
        newRegistrationToken: `token-${n}`,
        newCreateRequestId: `request-${n}`,
      });
    await reserve(1);
    await expect(reserve(2)).rejects.toThrow("already");
    expect(await subscription(t, accountId)).toBeNull();
    expect(await transitions(t, accountId)).toEqual([]);
  });
});

describe("evaluator", () => {
  test("a trial reaches past_due at nextBillingAt and suspended at grace end", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    await startTrial(t, accountId);
    await t.mutation(internal.billing.evaluateOrg, { accountId, now: T0 + 30 * DAY });
    expect(await subscription(t, accountId)).toMatchObject({ state: "past_due", stateReason: "no_payment_method" });
    await t.mutation(internal.billing.evaluateOrg, { accountId, now: T0 + 44 * DAY });
    const suspended = await subscription(t, accountId);
    expect(suspended).toMatchObject({ state: "suspended", stateReason: "no_payment_method" });
    expect(suspended?.spinDownAt).toBe(T0 + 51 * DAY);
    expect((await transitions(t, accountId)).map(([, event]) => event)).toEqual([
      "TrialStarted",
      "EvaluationDue",
      "GraceExpired",
    ]);
  });

  test("running it twice is a no-op", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    await startTrial(t, accountId);
    const at = T0 + 30 * DAY;
    expect(await t.mutation(internal.billing.evaluateOrg, { accountId, now: at })).toEqual({ applied: 1 });
    const once = await subscription(t, accountId);
    expect(await t.mutation(internal.billing.evaluateOrg, { accountId, now: at })).toEqual({ applied: 0 });
    expect(await subscription(t, accountId)).toEqual(once);
  });

  test("schedules each due org on its own, so one that throws doesn't stop the others", async () => {
    const t = newBackend();
    const good = await seedOrg(t, "Good");
    const broken = await seedOrg(t, "Broken");
    const notDue = await seedOrg(t, "Not due");
    const past = Date.now() - DAY;
    await startTrial(t, good.accountId, past - 30 * DAY);
    await startTrial(t, notDue.accountId, Date.now());
    await t.run(async (ctx) => {
      // A past_due row with no reason breaks its write invariants on the next transition.
      await ctx.db.insert("subscriptions", {
        accountId: broken.accountId,
        plan: "starter",
        state: "past_due",
        stateSince: past - DAY,
        graceEndsAt: past,
        nextCheckAt: past,
        addOns: [],
        origin: "signup",
        updatedAt: past,
        updatedBy: "test",
      });
    });
    expect(await t.mutation(internal.billing.evaluateDue, {})).toEqual({ scheduled: 2 });
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name === "billing:evaluateOrg")
    );
    const outcomes = await Promise.allSettled(
      jobs.map((job) =>
        t.mutation(internal.billing.evaluateOrg, job.args[0] as { accountId: Id<"accounts">; now: number })
      )
    );
    expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await subscription(t, good.accountId))?.state).toBe("past_due");
    expect((await subscription(t, notDue.accountId))?.state).toBe("trialing");
  });
});

describe("deliverWarning", () => {
  test("sends once per transition and template, to the owner with the billing link", async () => {
    const t = newBackend();
    const { accountId, ownerId } = await seedOrg(t);
    const { transitionId, subscription: row } = await startTrial(t, accountId);
    const args = {
      accountId,
      transitionId,
      template: "billing-trial-ending" as const,
      stint: { state: row.state, stateSince: row.stateSince },
    };
    expect(await t.mutation(internal.billing.deliverWarning, args)).toEqual({ sent: true });
    expect(await t.mutation(internal.billing.deliverWarning, args)).toEqual({ sent: false });
    const sent = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(sent.map((n) => [n.audience, n.link])).toEqual([[{ kind: "user", userId: ownerId }, "/org/billing"]]);
  });

  test("a warning from a stint the org has left is skipped", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const { transitionId, subscription: row } = await startTrial(t, accountId);
    await t.mutation(internal.billing.evaluateOrg, { accountId, now: T0 + 30 * DAY });
    const result = await t.mutation(internal.billing.deliverWarning, {
      accountId,
      transitionId,
      template: "billing-trial-ending",
      stint: { state: row.state, stateSince: row.stateSince },
    });
    expect(result).toEqual({ sent: false });
  });
});

describe("migrations", () => {
  async function managedEngine(t: Backend, accountId: Id<"accounts">, requestedBy: Id<"users">) {
    await t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("instances", {
        accountId,
        name: "Hosted",
        url: "",
        hosting: "managed",
        createdAt: 1,
      });
      await ctx.db.insert("engineProvisioning", {
        instanceId,
        accountId,
        requestedBy,
        slug: `slug-${accountId}`,
        status: "registered",
        steps: [],
        registrationToken: "token",
        registrationAttempts: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    });
  }

  test("M3 gives a managed org a trial billed migrationBillingDelayDays out, once", async () => {
    const t = newBackend();
    const managed = await seedOrg(t, "Managed");
    const selfHosted = await seedOrg(t, "Self-hosted");
    await managedEngine(t, managed.accountId, managed.ownerId);
    const before = Date.now();
    await runMigration(t, internal.migrations.subscriptions.seedSubscriptions);
    const row = await subscription(t, managed.accountId);
    expect(row).toMatchObject({ state: "trialing", plan: "starter", origin: "migration", updatedBy: "migration" });
    expect((row?.nextBillingAt ?? 0) - (row?.trialStartedAt ?? 0)).toBe(30 * DAY);
    expect(row?.trialStartedAt).toBeGreaterThanOrEqual(before);
    expect(await subscription(t, selfHosted.accountId)).toBeNull();
    await runMigration(t, internal.migrations.subscriptions.seedSubscriptions);
    expect(await transitions(t, managed.accountId)).toEqual([[null, "TrialStarted", "trialing"]]);
  });

  test("M6 before M3 leaves a comped org exempt rather than trialing", async () => {
    const t = newBackend();
    const comped = await seedOrg(t, "Comped");
    const oddPlan = await seedOrg(t, "Odd plan");
    await managedEngine(t, comped.accountId, comped.ownerId);
    await t.run(async (ctx) => {
      const pro = await ctx.db.insert("plans", {
        key: "pro",
        name: "Pro",
        features: [],
        limits: [],
        offered: true,
        isDefault: false,
        updatedAt: 1,
        updatedBy: "test",
      });
      const legacy = await ctx.db.insert("plans", {
        key: "legacy",
        name: "Legacy",
        features: [],
        limits: [],
        offered: false,
        isDefault: false,
        updatedAt: 1,
        updatedBy: "test",
      });
      const assignment = { addFeatures: [], removeFeatures: [], limits: [], updatedAt: 1, updatedBy: "test" };
      await ctx.db.insert("accountPlans", { accountId: comped.accountId, planId: pro, ...assignment });
      await ctx.db.insert("accountPlans", { accountId: oddPlan.accountId, planId: legacy, ...assignment });
    });
    await runMigration(t, internal.migrations.subscriptions.exemptionsFromPlanAssignments);
    await runMigration(t, internal.migrations.subscriptions.seedSubscriptions);
    const row = await subscription(t, comped.accountId);
    expect(row).toMatchObject({ state: "exempt", plan: "pro", origin: "migration" });
    expect(row?.exemptUntil).toBeUndefined();
    expect(await subscription(t, oddPlan.accountId)).toBeNull();
  });
});
