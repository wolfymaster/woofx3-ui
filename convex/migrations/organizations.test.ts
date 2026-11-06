import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, runMigration } from "../lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

interface Seeded {
  accountId: Id<"accounts">;
  ownerId: Id<"users">;
  instanceId: Id<"instances">;
  secondId: Id<"instances">;
  strayOwnerId: Id<"users">;
  engineOwnerId: Id<"users">;
  outsiderId: Id<"users">;
  lowAdminId: Id<"users">;
}

/** One org with every anomaly the migrations fix. */
async function seedAnomalies(t: Backend): Promise<Seeded> {
  return t.run(async (ctx) => {
    const user = (name: string) => ctx.db.insert("users", { name });
    const ownerId = await user("Owner");
    const strayOwnerId = await user("Stray owner row");
    const engineOwnerId = await user("Engine owner, not org owner");
    const outsiderId = await user("On the engine, not in the org");
    const lowAdminId = await user("Org admin with engine member");
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    // I1: no owner row, and a stray one.
    await ctx.db.insert("accountMembers", { accountId, userId: strayOwnerId, role: "owner", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: lowAdminId, role: "admin", createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", { accountId, name: "Main", url: "https://a", createdAt: 1 });
    const secondId = await ctx.db.insert("instances", { accountId, name: "Second", url: "https://b", createdAt: 1 });
    // I3: the owner only holds the first engine; someone else owns it too.
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: engineOwnerId, role: "owner" });
    // I2: an engine member outside the org.
    await ctx.db.insert("instanceMembers", { instanceId, userId: outsiderId, role: "member" });
    // I4: an org admin below engine admin.
    await ctx.db.insert("instanceMembers", { instanceId, userId: lowAdminId, role: "member" });
    return { accountId, ownerId, instanceId, secondId, strayOwnerId, engineOwnerId, outsiderId, lowAdminId };
  });
}

async function violations(t: Backend) {
  return (await t.action(internal.migrations.organizations.checkOrgInvariantsAll, {})).violations;
}

async function snapshot(t: Backend) {
  return t.run(async (ctx) => ({
    org: (await ctx.db.query("accountMembers").collect()).map((r) => [r.userId, r.role]).sort(),
    engine: (await ctx.db.query("instanceMembers").collect()).map((r) => [r.instanceId, r.userId, r.role]).sort(),
  }));
}

async function migrateRoles(t: Backend) {
  await runMigration(t, internal.migrations.organizations.orgOwnerRows);
  await runMigration(t, internal.migrations.organizations.orgMembershipFromEngines);
}

describe("organization role migrations", () => {
  test("M5 reports each seeded anomaly", async () => {
    const t = newBackend();
    const s = await seedAnomalies(t);
    const found = (await violations(t)).map((x) => [x.invariant, "userId" in x ? x.userId : null]);
    expect(found).toContainEqual(["I1", null]);
    expect(found).toContainEqual(["I1", s.strayOwnerId]);
    expect(found).toContainEqual(["I2", s.outsiderId]);
    expect(found).toContainEqual(["I2", s.engineOwnerId]);
    expect(found).toContainEqual(["I3", s.engineOwnerId]);
    expect(found).toContainEqual(["I3", s.ownerId]);
    expect(found).toContainEqual(["I4", s.lowAdminId]);
  });

  test("M1 then M2 leave M5 with nothing to report", async () => {
    const t = newBackend();
    const s = await seedAnomalies(t);
    await migrateRoles(t);
    expect(await violations(t)).toEqual([]);
    const after = await snapshot(t);
    expect(after.org).toContainEqual([s.ownerId, "owner"]);
    expect(after.org).toContainEqual([s.strayOwnerId, "admin"]);
    expect(after.org).toContainEqual([s.engineOwnerId, "admin"]);
    expect(after.org).toContainEqual([s.outsiderId, "member"]);
    expect(after.engine).toContainEqual([s.secondId, s.ownerId, "owner"]);
    expect(after.engine).toContainEqual([s.instanceId, s.engineOwnerId, "admin"]);
    expect(after.engine).toContainEqual([s.instanceId, s.lowAdminId, "admin"]);
    expect(after.engine).toContainEqual([s.instanceId, s.outsiderId, "member"]);
  });

  test("running them twice changes nothing", async () => {
    const t = newBackend();
    await seedAnomalies(t);
    await migrateRoles(t);
    const once = await snapshot(t);
    await migrateRoles(t);
    expect(await snapshot(t)).toEqual(once);
  });
});
