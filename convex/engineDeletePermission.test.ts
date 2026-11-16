import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import { newBackend } from "./lib/convexTest.testing";

async function fixture() {
  const t = newBackend();
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const orgAdminId = await ctx.db.insert("users", { name: "OrgAdmin" });
    const engineAdminId = await ctx.db.insert("users", { name: "EngineAdmin" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: orgAdminId, role: "admin", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: engineAdminId, role: "member", createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: orgAdminId, role: "admin" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: engineAdminId, role: "admin" });
    await ctx.db.insert("engineProvisioning", {
      instanceId,
      accountId,
      requestedBy: ownerId,
      maintenanceEngineId: "eng_1",
      slug: "wolfy",
      status: "registered",
      steps: [],
      registrationToken: "token",
      createdAt: 1,
      updatedAt: 1,
    });
    return { ownerId, orgAdminId, engineAdminId, instanceId };
  });
  const as = (userId: typeof ids.ownerId) => t.withIdentity({ subject: `${userId}|session` });
  return {
    t,
    instanceId: ids.instanceId,
    owner: as(ids.ownerId),
    orgAdmin: as(ids.orgAdminId),
    engineAdmin: as(ids.engineAdminId),
  };
}

describe("deleting an engine is the organization owner's call", () => {
  for (const who of ["orgAdmin", "engineAdmin"] as const) {
    test(`an engine admin who is an org ${who === "orgAdmin" ? "admin" : "member"} cannot delete the instance`, async () => {
      const f = await fixture();
      await expect(f[who].action(api.instances.deleteInstance, { instanceId: f.instanceId })).rejects.toMatchObject({
        data: { code: "not_authorized", action: "deleteEngine" },
      });
      expect(await f.t.run((ctx) => ctx.db.get(f.instanceId))).not.toBeNull();
    });

    test(`an engine admin who is an org ${who === "orgAdmin" ? "admin" : "member"} cannot tear down the managed engine`, async () => {
      const f = await fixture();
      await expect(
        f[who].action(api.provisioning.deleteManagedEngine, { instanceId: f.instanceId })
      ).rejects.toMatchObject({ data: { code: "not_authorized", action: "deleteEngine" } });
    });
  }

  test("the owner deletes the instance", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("engineProvisioning")
        .withIndex("by_instance", (q) => q.eq("instanceId", f.instanceId))
        .first();
      if (row) {
        await ctx.db.delete(row._id);
      }
    });
    await f.owner.action(api.instances.deleteInstance, { instanceId: f.instanceId });
    expect(await f.t.run((ctx) => ctx.db.get(f.instanceId))).toBeNull();
  });
});
