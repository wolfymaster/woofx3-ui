import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;
type Hosting = "managed" | "external";

async function seed(t: Backend) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Wolfy" });
    const modId = await ctx.db.insert("users", { name: "Kit" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: modId, role: "member", createdAt: 1 });
    return { ownerId, modId, accountId };
  });
}

async function addEngine(
  t: Backend,
  accountId: Id<"accounts">,
  members: Id<"users">[],
  {
    hosting = "managed",
    createdAt = 1,
    registered = true,
  }: { hosting?: Hosting; createdAt?: number; registered?: boolean } = {}
): Promise<Id<"instances">> {
  return t.run(async (ctx) => {
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Engine",
      url: "https://e.example",
      hosting,
      createdAt,
      ...(registered ? { clientId: `client-${createdAt}` } : {}),
    });
    for (const userId of members) {
      await ctx.db.insert("instanceMembers", { instanceId, userId, role: "member" });
    }
    return instanceId;
  });
}

function as(t: Backend, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session` });
}

async function suspend(t: Backend, accountId: Id<"accounts">) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgBilling", {
      accountId,
      version: 1,
      tier: "starter",
      addOns: [],
      standing: "suspended",
      reason: "no_payment_method",
      trialEndsAt: null,
      graceEndsAt: null,
      periodEnd: null,
      interval: null,
      exemptUntil: null,
      spinDownAt: null,
      hasProviderSubscription: false,
      discount: null,
      overrides: { addFeatures: [], removeFeatures: [], limits: [] },
      updatedAt: 1,
    });
  });
}

describe("access.entry", () => {
  test("a user with no engines is sent to create one in the org they own", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seed(t);
    expect(await as(t, ownerId).query(api.access.entry, { selectedInstanceId: null })).toEqual({
      kind: "createEngine",
      accountId,
    });
  });

  test("an engine still being built is not an engine to enter", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seed(t);
    await addEngine(t, accountId, [ownerId], { registered: false });
    expect(await as(t, ownerId).query(api.access.entry, { selectedInstanceId: null })).toEqual({
      kind: "createEngine",
      accountId,
    });
  });

  test("someone removed from their only engine, owning no org, creates an engine with none", async () => {
    const t = newBackend();
    const { ownerId, modId, accountId } = await seed(t);
    const engine = await addEngine(t, accountId, [ownerId, modId]);
    const mod = as(t, modId);
    expect(await mod.query(api.access.entry, { selectedInstanceId: engine })).toEqual({
      kind: "engine",
      instanceId: engine,
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("instanceMembers")
        .withIndex("by_instance_user", (q) => q.eq("instanceId", engine).eq("userId", modId))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    });
    expect(await mod.query(api.access.entry, { selectedInstanceId: engine })).toEqual({
      kind: "createEngine",
      accountId: null,
    });
  });

  test("the selected engine wins, then the default, then the latest", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seed(t);
    const older = await addEngine(t, accountId, [ownerId], { createdAt: 1 });
    const newer = await addEngine(t, accountId, [ownerId], { createdAt: 2 });
    const owner = as(t, ownerId);
    expect(await owner.query(api.access.entry, { selectedInstanceId: null })).toEqual({
      kind: "engine",
      instanceId: newer,
    });
    await owner.mutation(api.userSettings.setDefaultEngine, { instanceId: older });
    expect(await owner.query(api.access.entry, { selectedInstanceId: null })).toEqual({
      kind: "engine",
      instanceId: older,
    });
    expect(await owner.query(api.access.entry, { selectedInstanceId: newer })).toEqual({
      kind: "engine",
      instanceId: newer,
    });
  });

  test("a stale default engine falls back to the latest one", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seed(t);
    const stale = await addEngine(t, accountId, [ownerId], { createdAt: 1 });
    const kept = await addEngine(t, accountId, [ownerId], { createdAt: 0 });
    const owner = as(t, ownerId);
    await owner.mutation(api.userSettings.setDefaultEngine, { instanceId: stale });
    await t.run((ctx) => ctx.db.delete(stale));
    expect(await owner.query(api.access.entry, { selectedInstanceId: stale })).toEqual({
      kind: "engine",
      instanceId: kept,
    });
  });

  test("a suspended org locks its hosted engine: the owner may reactivate, others ask the owner", async () => {
    const t = newBackend();
    const { ownerId, modId, accountId } = await seed(t);
    const engine = await addEngine(t, accountId, [ownerId, modId]);
    await suspend(t, accountId);
    expect(await as(t, ownerId).query(api.access.entry, { selectedInstanceId: engine })).toEqual({
      kind: "suspended",
      instanceId: engine,
      reason: "no_payment_method",
      canManageBilling: true,
      ownerName: "Wolfy",
    });
    expect(await as(t, modId).query(api.access.entry, { selectedInstanceId: engine })).toMatchObject({
      kind: "suspended",
      canManageBilling: false,
      ownerName: "Wolfy",
    });
  });

  test("a suspended org's self-hosted engine stays open", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seed(t);
    const engine = await addEngine(t, accountId, [ownerId], { hosting: "external" });
    await suspend(t, accountId);
    expect(await as(t, ownerId).query(api.access.entry, { selectedInstanceId: engine })).toEqual({
      kind: "engine",
      instanceId: engine,
    });
  });

  test("signed out, there is no entry", async () => {
    const t = newBackend();
    expect(await t.query(api.access.entry, { selectedInstanceId: null })).toBeNull();
  });
});
