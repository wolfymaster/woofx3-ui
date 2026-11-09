import { describe, expect, spyOn, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BILLING_LIFECYCLE } from "./lib/billingLifecycle";
import { billingBanner } from "./lib/billingWarnings";
import { newBackend } from "./lib/convexTest.testing";
import { dateText } from "./lib/dateText";
import { applyTransition } from "./lib/subscriptions";
import { stubFetch } from "./lib/twitchEngineHelix.fakes";
import { logger } from "./logger";

type Backend = ReturnType<typeof newBackend>;

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1);
const ENV = {
  MAINTENANCE_API_URL: "https://maintenance.example",
  MAINTENANCE_API_KEY: "key",
  ORG_PORTAL_URL: "https://woofx3.tv/org",
};

/** Runs `fn` with the mail service configured and billing's warning logs muted, restoring both after. */
/** Runs `fn` with the mail service configured, and returns what it logged as errors. */
async function withMailService(fn: () => Promise<unknown>): Promise<{ errors: unknown[][] }> {
  const saved = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  const muted = [
    spyOn(logger, "warn").mockImplementation(() => {}),
    spyOn(logger, "error").mockImplementation(() => {}),
  ];
  try {
    await fn();
    return { errors: muted[1]?.mock.calls ?? [] };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    for (const spy of muted) {
      spy.mockRestore();
    }
  }
}

async function trialOrg(t: Backend, ownerEmail: string | undefined) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner", email: ownerEmail });
    const accountId = await ctx.db.insert("accounts", { name: "Wolfy Streams", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    const result = await applyTransition(ctx, {
      accountId,
      event: { kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.trialDays },
      now: T0,
      actor: "test",
      origin: "signup",
    });
    if (!result.ok) {
      throw new Error("fixture");
    }
    return {
      accountId,
      transitionId: result.transitionId,
      stint: { state: result.subscription.state, stateSince: T0 },
    };
  });
}

async function scheduled(t: Backend, name: string) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name === name)
  );
}

function deliver(t: Backend, org: Awaited<ReturnType<typeof trialOrg>>) {
  return t.mutation(internal.billing.deliverWarning, {
    accountId: org.accountId,
    transitionId: org.transitionId,
    template: "billing-trial-ending",
    stint: org.stint,
  });
}

describe("warning email", () => {
  test("is scheduled once per transition and template, keyed for the mail service", async () => {
    const t = newBackend();
    const org = await trialOrg(t, "owner@example.com");
    await deliver(t, org);
    await deliver(t, org);
    const emails = await scheduled(t, "billing:sendWarningEmail");
    expect(emails.map((job) => job.args[0])).toEqual([
      expect.objectContaining({
        template: "billing-trial-ending",
        to: "owner@example.com",
        idempotencyKey: `${org.transitionId}:billing-trial-ending`,
        variables: expect.objectContaining({
          orgName: "Wolfy Streams",
          planName: "Starter",
          dateText: expect.stringMatching(/^[A-Z][a-z]+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M P[SD]T$/),
        }),
      }),
    ]);
  });

  test("an owner without an email gets in-app only, noted on the transition", async () => {
    const t = newBackend();
    const org = await trialOrg(t, undefined);
    expect(await deliver(t, org)).toEqual({ sent: true });
    expect(await scheduled(t, "billing:sendWarningEmail")).toEqual([]);
    const transition = await t.run((ctx) => ctx.db.get(org.transitionId));
    expect(transition?.ownerEmailMissing).toBe(true);
  });

  test("a warning is skipped once a payment has moved the org on", async () => {
    const t = newBackend();
    const org = await trialOrg(t, "owner@example.com");
    await t.run((ctx) =>
      applyTransition(ctx, {
        accountId: org.accountId,
        event: { kind: "ProviderActivated", plan: "starter", currentPeriodEnd: T0 + 40 * DAY },
        now: T0 + DAY,
        actor: "test",
        origin: "signup",
      })
    );
    expect(await deliver(t, org)).toEqual({ sent: false });
    expect(await scheduled(t, "billing:sendWarningEmail")).toEqual([]);
  });

  test("a mail service failure retries later and leaves the transition alone", async () => {
    const t = newBackend();
    const org = await trialOrg(t, "owner@example.com");
    const fetchStub = stubFetch(() => new Response("down", { status: 503 }));
    try {
      await withMailService(() =>
        t.action(internal.billing.sendWarningEmail, {
          template: "billing-trial-ending",
          to: "owner@example.com",
          variables: { orgName: "Wolfy Streams", planName: "Starter", dateText: dateText(T0) },
          idempotencyKey: `${org.transitionId}:billing-trial-ending`,
          attempt: 0,
        })
      );
    } finally {
      fetchStub.restore();
    }
    const call = fetchStub.calls[0];
    expect(call?.url).toBe("https://maintenance.example/v1/email/messages");
    expect(JSON.parse(String(call?.init?.body))).toMatchObject({
      template: "billing-trial-ending",
      variables: { billingUrl: "https://woofx3.tv/org/billing" },
    });
    const retries = await scheduled(t, "billing:sendWarningEmail");
    expect(retries.map((job) => (job.args[0] as { attempt: number }).attempt)).toEqual([1]);
    expect((await t.run((ctx) => ctx.db.get(org.transitionId)))?.event).toBe("TrialStarted");
  });

  test("a refused send is not retried, and giving up never logs the owner's address", async () => {
    const t = newBackend();
    const org = await trialOrg(t, "owner@example.com");
    const fetchStub = stubFetch(() =>
      Response.json({ error: { code: "unknown_template", message: "no such template" } }, { status: 422 })
    );
    let logged: unknown[][] = [];
    try {
      ({ errors: logged } = await withMailService(() =>
        t.action(internal.billing.sendWarningEmail, {
          template: "billing-trial-ending",
          to: "owner@example.com",
          variables: { orgName: "Org", planName: "Starter", dateText: dateText(T0) },
          idempotencyKey: `${org.transitionId}:billing-trial-ending`,
          attempt: 0,
        })
      ));
    } finally {
      fetchStub.restore();
    }
    expect(await scheduled(t, "billing:sendWarningEmail")).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain("owner@example.com");
  });

  test("a misconfigured portal URL fails at once instead of being retried as an outage", async () => {
    const t = newBackend();
    const org = await trialOrg(t, "owner@example.com");
    const fetchStub = stubFetch(() => Response.json({ id: "msg_1" }));
    try {
      await withMailService(async () => {
        delete process.env.ORG_PORTAL_URL;
        await expect(
          t.action(internal.billing.sendWarningEmail, {
            template: "billing-trial-ending",
            to: "owner@example.com",
            variables: { orgName: "Org", planName: "Starter", dateText: dateText(T0) },
            idempotencyKey: `${org.transitionId}:billing-trial-ending`,
            attempt: 0,
          })
        ).rejects.toThrow("ORG_PORTAL_URL");
      });
    } finally {
      fetchStub.restore();
    }
    expect(fetchStub.calls).toEqual([]);
    expect(await scheduled(t, "billing:sendWarningEmail")).toEqual([]);
  });
});

describe("billingBanner", () => {
  const ends = T0 + 30 * DAY;
  const cases: Array<[string, Parameters<typeof billingBanner>[0], number, ReturnType<typeof billingBanner>]> = [
    ["no subscription", null, T0, null],
    ["early in a trial", { state: "trialing", nextBillingAt: ends, graceEndsAt: null }, T0, null],
    [
      "the last week of a trial",
      { state: "trialing", nextBillingAt: ends, graceEndsAt: null },
      ends - 7 * DAY,
      { kind: "trial_ending", dateIso: new Date(ends).toISOString() },
    ],
    [
      "past due",
      { state: "past_due", nextBillingAt: null, graceEndsAt: ends },
      T0,
      { kind: "payment_needed", dateIso: new Date(ends).toISOString() },
    ],
    ["exempt", { state: "exempt", nextBillingAt: null, graceEndsAt: null }, T0, null],
    ["active", { state: "active", nextBillingAt: ends, graceEndsAt: null }, ends - DAY, null],
  ];
  for (const [name, subscription, now, expected] of cases) {
    test(name, () => {
      expect(billingBanner(subscription, now)).toEqual(expected);
    });
  }
});

describe("bannerForViewer", () => {
  async function pastDueOrg(t: Backend, hosting: "managed" | "external") {
    return t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const memberId = await ctx.db.insert("users", { name: "Member" });
      const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: memberId, role: "member", createdAt: 1 });
      const instanceId: Id<"instances"> = await ctx.db.insert("instances", {
        accountId,
        name: "Main",
        url: "https://e",
        hosting,
        createdAt: 1,
      });
      await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
      await ctx.db.insert("instanceMembers", { instanceId, userId: memberId, role: "member" });
      await ctx.db.insert("plans", {
        key: "starter",
        name: "Starter",
        features: [],
        limits: [],
        offered: true,
        isDefault: false,
        updatedAt: 1,
        updatedBy: "test",
      });
      await ctx.db.insert("subscriptions", {
        accountId,
        plan: "starter",
        state: "past_due",
        stateReason: "payment_failed",
        stateSince: T0,
        graceEndsAt: T0 + 14 * DAY,
        nextCheckAt: T0 + 14 * DAY,
        addOns: [],
        origin: "signup",
        updatedAt: T0,
        updatedBy: "test",
      });
      return { instanceId, ownerId, memberId };
    });
  }

  test("the owner can act on it; a member sees the date only", async () => {
    const t = newBackend();
    const { instanceId, ownerId, memberId } = await pastDueOrg(t, "managed");
    const asOwner = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.billing.bannerForViewer, {
      instanceId,
      now: T0,
    });
    expect(asOwner).toMatchObject({ kind: "payment_needed", canManageBilling: true });
    const asMember = await t.withIdentity({ subject: `${memberId}|s` }).query(api.billing.bannerForViewer, {
      instanceId,
      now: T0,
    });
    expect(asMember).toMatchObject({ kind: "payment_needed", canManageBilling: false });
  });

  test("a self-hosted engine never shows one", async () => {
    const t = newBackend();
    const { instanceId, ownerId } = await pastDueOrg(t, "external");
    expect(
      await t.withIdentity({ subject: `${ownerId}|s` }).query(api.billing.bannerForViewer, { instanceId, now: T0 })
    ).toBeNull();
  });
});
