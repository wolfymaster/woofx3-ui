import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import { newBackend } from "./lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

/** Everything an organization brings with it: its membership, an engine, setup state and billing. */
async function organizationRows(t: Backend) {
  return t.run(async (ctx) => ({
    accounts: await ctx.db.query("accounts").take(10),
    accountMembers: await ctx.db.query("accountMembers").take(10),
    instances: await ctx.db.query("instances").take(10),
    instanceSetup: await ctx.db.query("instanceSetup").take(10),
    orgBilling: await ctx.db.query("orgBilling").take(10),
    scheduled: await ctx.db.system.query("_scheduled_functions").take(10),
  }));
}

const NOTHING = {
  accounts: [],
  accountMembers: [],
  instances: [],
  instanceSetup: [],
  orgBilling: [],
  scheduled: [],
};

describe("a signed-in user with no engine", () => {
  const saved = { url: process.env.MAINTENANCE_API_URL, key: process.env.MAINTENANCE_API_KEY };

  beforeEach(() => {
    // Hosted engines on offer, as in production: the case where onboarding could start one.
    process.env.MAINTENANCE_API_URL = "https://maintenance.test";
    process.env.MAINTENANCE_API_KEY = "key";
  });

  afterEach(() => {
    process.env.MAINTENANCE_API_URL = saved.url;
    process.env.MAINTENANCE_API_KEY = saved.key;
  });

  test("loading the dashboard, onboarding and the account portal makes no organization", async () => {
    const t = newBackend();
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "sponsor@example.com" }));
    const asUser = t.withIdentity({ subject: `${userId}|session` });

    expect(await asUser.query(api.access.entry, { selectedInstanceId: null })).toEqual({
      kind: "createEngine",
      accountId: null,
    });
    expect(await asUser.query(api.instances.listForCurrentUser, {})).toEqual([]);
    expect(await asUser.query(api.provisioning.isAvailable, {})).toEqual({ available: true });
    expect(await asUser.query(api.previewEngine.get, {})).toBeNull();
    expect(await asUser.query(api.accounts.getMyAccount, {})).toBeNull();
    expect(await asUser.query(api.organizations.mine, { now: Date.now() })).toEqual([]);
    await asUser.query(api.users.getMe, {});

    expect(await organizationRows(t)).toEqual(NOTHING);
  });

  test("choosing a hosted engine is what makes the organization, engine and trial", async () => {
    const t = newBackend();
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "streamer@example.com" }));
    await t.withIdentity({ subject: `${userId}|session` }).mutation(api.setup.ensureFirstRun, {});

    const rows = await organizationRows(t);
    expect(rows.accounts.map((account) => account.ownerId)).toEqual([userId]);
    expect(rows.accountMembers.map((member) => member.role)).toEqual(["owner"]);
    expect(rows.instances.map((instance) => instance.hosting)).toEqual(["managed"]);
    expect(rows.scheduled.map((job) => job.name)).toEqual(["billingCommands:ensureBilling"]);
  });
});
