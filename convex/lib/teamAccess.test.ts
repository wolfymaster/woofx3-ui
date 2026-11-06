import { describe, expect, test } from "bun:test";
import type { Id } from "../_generated/dataModel";
import { newBackend } from "./convexTest.testing";
import type { OrgRole } from "./organization";
import { orgRoleOf, requireOrgActionFor } from "./orgRoles";
import { grantEngineRole } from "./teamAccess";

type Backend = ReturnType<typeof newBackend>;

interface Org {
  accountId: Id<"accounts">;
  ownerId: Id<"users">;
  instanceId: Id<"instances">;
}

async function seedOrg(t: Backend): Promise<Org> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      createdAt: 1,
    });
    return { accountId, ownerId, instanceId };
  });
}

async function addUser(t: Backend, org: Org, role: OrgRole | null): Promise<Id<"users">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Someone" });
    if (role !== null) {
      await ctx.db.insert("accountMembers", { accountId: org.accountId, userId, role, createdAt: 1 });
    }
    return userId;
  });
}

async function rolesOf(t: Backend, org: Org, userId: Id<"users">) {
  return t.run(async (ctx) => {
    const orgRow = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) => q.eq("accountId", org.accountId).eq("userId", userId))
      .unique();
    const engineRow = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", org.instanceId).eq("userId", userId))
      .unique();
    return { org: orgRow?.role ?? null, engine: engineRow?.role ?? null, engineCreatedAt: engineRow?.createdAt };
  });
}

describe("grantEngineRole", () => {
  test("a user outside the org joins it as a member (I2)", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const userId = await addUser(t, org, null);
    await t.run((ctx) => grantEngineRole(ctx, org.instanceId, userId, "member"));
    const roles = await rolesOf(t, org, userId);
    expect(roles.org).toBe("member");
    expect(roles.engine).toBe("member");
    expect(roles.engineCreatedAt).toBeNumber();
  });

  test("an existing org member keeps their org role", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const userId = await addUser(t, org, "member");
    await t.run((ctx) => grantEngineRole(ctx, org.instanceId, userId, "admin"));
    expect(await rolesOf(t, org, userId)).toMatchObject({ org: "member", engine: "admin" });
  });

  test("refuses engine owner for anyone but the org owner (I3)", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const userId = await addUser(t, org, "admin");
    await expect(t.run((ctx) => grantEngineRole(ctx, org.instanceId, userId, "owner"))).rejects.toThrow(
      "Only the organization owner"
    );
    expect((await rolesOf(t, org, userId)).engine).toBeNull();
  });

  test("refuses less than engine owner for the org owner (I3)", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await expect(t.run((ctx) => grantEngineRole(ctx, org.instanceId, org.ownerId, "admin"))).rejects.toThrow(
      "always owns"
    );
  });

  test("raises an org admin to at least engine admin (I4)", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const userId = await addUser(t, org, "admin");
    const granted = await t.run((ctx) => grantEngineRole(ctx, org.instanceId, userId, "member"));
    expect(granted).toBe("admin");
    expect((await rolesOf(t, org, userId)).engine).toBe("admin");
  });

  test("granting again changes nothing", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const userId = await addUser(t, org, null);
    await t.run((ctx) => grantEngineRole(ctx, org.instanceId, userId, "member"));
    await t.run((ctx) => grantEngineRole(ctx, org.instanceId, userId, "member"));
    const counts = await t.run(async (ctx) => ({
      org: (await ctx.db.query("accountMembers").collect()).length,
      engine: (await ctx.db.query("instanceMembers").collect()).length,
    }));
    expect(counts).toEqual({ org: 2, engine: 1 });
  });
});

describe("org role resolution", () => {
  test("a stray owner row for a non-owner counts as admin (I1)", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const userId = await addUser(t, org, "owner");
    const role = await t.run(async (ctx) => {
      const account = await ctx.db.get(org.accountId);
      if (account === null) {
        throw new Error("seeded account is missing");
      }
      return orgRoleOf(ctx, account, userId);
    });
    expect(role).toBe("admin");
    await expect(t.run((ctx) => requireOrgActionFor(ctx, org.accountId, userId, "manageBilling"))).rejects.toThrow(
      "Your organization role doesn't allow this"
    );
  });

  test("the owner is the owner even before their membership row exists", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("accountMembers")
        .withIndex("by_account_user", (q) => q.eq("accountId", org.accountId).eq("userId", org.ownerId))
        .unique();
      if (row !== null) {
        await ctx.db.delete(row._id);
      }
    });
    const actor = await t.run((ctx) => requireOrgActionFor(ctx, org.accountId, org.ownerId, "manageBilling"));
    expect(actor.role).toBe("owner");
  });
});
