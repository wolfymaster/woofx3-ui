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
    expect(await t.action(internal.migrations.organizations.checkOrgInvariantsAll, {})).toEqual({
      total: 0,
      violations: [],
      overSeatLimit: [],
    });
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

  test("M1 reports an org with two owner rows and still migrates its other members", async () => {
    const t = newBackend();
    const s = await seedAnomalies(t);
    const doubled = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Doubled owner" });
      const adminId = await ctx.db.insert("users", { name: "Admin of the doubled org" });
      const accountId = await ctx.db.insert("accounts", { name: "Doubled", ownerId, createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "member", createdAt: 2 });
      await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
      const instanceId = await ctx.db.insert("instances", { accountId, name: "D", url: "https://d", createdAt: 1 });
      await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
      await ctx.db.insert("instanceMembers", { instanceId, userId: adminId, role: "member" });
      return { accountId, ownerId, adminId, instanceId };
    });
    await runMigration(t, internal.migrations.organizations.orgOwnerRows);
    const after = await snapshot(t);
    expect(after.org).toContainEqual([s.ownerId, "owner"]);
    expect(after.org).toContainEqual([s.strayOwnerId, "admin"]);
    expect(after.org.filter(([userId]) => userId === doubled.ownerId)).toEqual([
      [doubled.ownerId, "member"],
      [doubled.ownerId, "owner"],
    ]);
    expect(after.engine).toContainEqual([doubled.instanceId, doubled.adminId, "admin"]);
    const found = (await violations(t)).filter((x) => x.accountId === doubled.accountId);
    expect(found).toEqual([
      { invariant: "duplicate_membership", accountId: doubled.accountId, userId: doubled.ownerId, rows: 2 },
    ]);
  });

  test("M1 and M2 skip members whose user is gone, and M5 reports them", async () => {
    const t = newBackend();
    const gone = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const goneAdminId = await ctx.db.insert("users", { name: "Deleted admin" });
      const goneEngineMemberId = await ctx.db.insert("users", { name: "Deleted engine member" });
      const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: goneAdminId, role: "owner", createdAt: 1 });
      const instanceId = await ctx.db.insert("instances", { accountId, name: "E", url: "https://e", createdAt: 1 });
      await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
      await ctx.db.insert("instanceMembers", { instanceId, userId: goneEngineMemberId, role: "member" });
      await ctx.db.delete(goneAdminId);
      await ctx.db.delete(goneEngineMemberId);
      return { accountId, instanceId, goneAdminId, goneEngineMemberId };
    });
    const before = await snapshot(t);
    await migrateRoles(t);
    expect(await snapshot(t)).toEqual(before);
    expect(await violations(t)).toEqual([
      { invariant: "member_user_missing", accountId: gone.accountId, userId: gone.goneAdminId },
      {
        invariant: "member_user_missing",
        accountId: gone.accountId,
        userId: gone.goneEngineMemberId,
        instanceId: gone.instanceId,
      },
    ]);
  });

  test("M1 still migrates the members of an org whose owner is gone, and M5 reports the owner", async () => {
    const t = newBackend();
    const org = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Deleted owner" });
      const adminId = await ctx.db.insert("users", { name: "Admin" });
      const accountId = await ctx.db.insert("accounts", { name: "Ownerless", ownerId, createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
      const instanceId = await ctx.db.insert("instances", { accountId, name: "O", url: "https://o", createdAt: 1 });
      await ctx.db.insert("instanceMembers", { instanceId, userId: adminId, role: "member" });
      await ctx.db.delete(ownerId);
      return { accountId, ownerId, adminId, instanceId };
    });
    await migrateRoles(t);
    expect((await snapshot(t)).engine).toEqual([[org.instanceId, org.adminId, "admin"]]);
    expect(await violations(t)).toEqual([
      { invariant: "owner_user_missing", accountId: org.accountId, userId: org.ownerId },
    ]);
  });

  test("M5 reports a member with two org rows", async () => {
    const t = newBackend();
    const s = await seedAnomalies(t);
    await migrateRoles(t);
    await t.run((ctx) =>
      ctx.db.insert("accountMembers", { accountId: s.accountId, userId: s.outsiderId, role: "member", createdAt: 2 })
    );
    expect(await violations(t)).toEqual([
      { invariant: "duplicate_membership", accountId: s.accountId, userId: s.outsiderId, rows: 2 },
    ]);
  });

  test("M2 keeps everyone already on an engine, even past the seat limit", async () => {
    const t = newBackend();
    const { accountId, outsiders } = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const accountId = await ctx.db.insert("accounts", { name: "Big team", ownerId, createdAt: 1 });
      const instanceId = await ctx.db.insert("instances", {
        accountId,
        name: "Hosted",
        url: "https://h",
        hosting: "managed",
        createdAt: 1,
      });
      await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
      const outsiders: Array<Id<"users">> = [];
      for (let i = 0; i < 6; i++) {
        const userId = await ctx.db.insert("users", { name: `Engine member ${i}` });
        await ctx.db.insert("instanceMembers", { instanceId, userId, role: "member" });
        outsiders.push(userId);
      }
      return { accountId, outsiders };
    });
    await migrateRoles(t);
    const orgRows = await t.run((ctx) =>
      ctx.db
        .query("accountMembers")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    );
    expect(orgRows.map((row) => row.userId)).toEqual(expect.arrayContaining(outsiders));
    const check = await t.action(internal.migrations.organizations.checkOrgInvariantsAll, {});
    expect(check.violations).toEqual([]);
    expect(check.overSeatLimit).toEqual([{ accountId, members: 7, limit: 5 }]);
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
