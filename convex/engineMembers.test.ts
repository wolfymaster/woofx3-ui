import { describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import type { EngineRole, OrgRole } from "./lib/organization";

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
      clientId: "client",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    return { accountId, ownerId, instanceId };
  });
}

async function addMember(
  t: Backend,
  org: Org,
  orgRole: OrgRole,
  engineRole: EngineRole | null,
  instanceId: Id<"instances"> = org.instanceId
): Promise<Id<"users">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${orgRole}-${engineRole}` });
    await ctx.db.insert("accountMembers", { accountId: org.accountId, userId, role: orgRole, createdAt: 1 });
    if (engineRole !== null) {
      await ctx.db.insert("instanceMembers", { instanceId, userId, role: engineRole });
    }
    return userId;
  });
}

function as(t: Backend, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session` });
}

async function engineRole(t: Backend, instanceId: Id<"instances">, userId: Id<"users">) {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
      .unique();
    return row?.role ?? null;
  });
}

async function orgRole(t: Backend, org: Org, userId: Id<"users">) {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) => q.eq("accountId", org.accountId).eq("userId", userId))
      .unique();
    return row?.role ?? null;
  });
}

describe("engineMembers.listForEngine", () => {
  test("lists the engine's members with both roles", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const memberId = await addMember(t, org, "member", "member");
    await addMember(t, org, "member", null);
    const result = await as(t, memberId).query(api.engineMembers.listForEngine, { instanceId: org.instanceId });
    expect(result?.canManage).toBe(false);
    expect(result?.canManageOrganization).toBe(false);
    expect(result?.members.map((m) => [m.orgRole, m.engineRole]).sort()).toEqual([
      ["member", "member"],
      ["owner", "owner"],
    ]);
  });

  test("an org admin may manage the organization", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addMember(t, org, "admin", "admin");
    const result = await as(t, adminId).query(api.engineMembers.listForEngine, { instanceId: org.instanceId });
    expect(result?.canManageOrganization).toBe(true);
  });

  test("sends email addresses to the org owner only", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await t.run((ctx) => ctx.db.patch(org.ownerId, { email: "owner@example.com" }));
    const adminId = await addMember(t, org, "admin", "admin");
    const memberId = await addMember(t, org, "member", "member");
    const forOwner = await as(t, org.ownerId).query(api.engineMembers.listForEngine, { instanceId: org.instanceId });
    expect(forOwner?.members.find((m) => m.userId === org.ownerId)?.email).toBe("owner@example.com");
    expect(forOwner?.members.find((m) => m.userId === memberId)?.email).toBeNull();
    for (const viewer of [adminId, memberId]) {
      const result = await as(t, viewer).query(api.engineMembers.listForEngine, { instanceId: org.instanceId });
      expect(result?.members.length).toBe(3);
      for (const member of result?.members ?? []) {
        expect("email" in member).toBe(false);
      }
    }
  });

  test("answers null to someone who isn't on the engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const outsiderId = await addMember(t, org, "member", null);
    expect(await as(t, outsiderId).query(api.engineMembers.listForEngine, { instanceId: org.instanceId })).toBeNull();
  });
});

describe("engineMembers.setRole", () => {
  test("an engine admin promotes a member on this engine only", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const otherId = await t.run((ctx) =>
      ctx.db.insert("instances", { accountId: org.accountId, name: "Second", url: "https://two.example", createdAt: 1 })
    );
    const adminId = await addMember(t, org, "member", "admin");
    const memberId = await addMember(t, org, "member", "member");
    await t.run((ctx) => ctx.db.insert("instanceMembers", { instanceId: otherId, userId: memberId, role: "member" }));
    await as(t, adminId).mutation(api.engineMembers.setRole, {
      instanceId: org.instanceId,
      targetUserId: memberId,
      role: "admin",
    });
    expect(await engineRole(t, org.instanceId, memberId)).toBe("admin");
    expect(await engineRole(t, otherId, memberId)).toBe("member");
    expect(await orgRole(t, org, memberId)).toBe("member");
  });

  test("an engine member may not change roles", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const memberId = await addMember(t, org, "member", "member");
    const targetId = await addMember(t, org, "member", "member");
    await expect(
      as(t, memberId).mutation(api.engineMembers.setRole, {
        instanceId: org.instanceId,
        targetUserId: targetId,
        role: "admin",
      })
    ).rejects.toThrow("Not authorized");
  });

  test("refuses to lower an org admin or touch the owner", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const orgAdminId = await addMember(t, org, "admin", "admin");
    await expect(
      as(t, org.ownerId).mutation(api.engineMembers.setRole, {
        instanceId: org.instanceId,
        targetUserId: orgAdminId,
        role: "member",
      })
    ).rejects.toMatchObject({ data: { code: "org_admin_has_every_engine" } });
    await expect(
      as(t, orgAdminId).mutation(api.engineMembers.setRole, {
        instanceId: org.instanceId,
        targetUserId: org.ownerId,
        role: "admin",
      })
    ).rejects.toThrow("always owns");
  });
});

describe("engineMembers.remove", () => {
  test("removing a user's last engine keeps them in the org", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const memberId = await addMember(t, org, "member", "member");
    await as(t, org.ownerId).mutation(api.engineMembers.remove, { instanceId: org.instanceId, targetUserId: memberId });
    expect(await engineRole(t, org.instanceId, memberId)).toBeNull();
    expect(await orgRole(t, org, memberId)).toBe("member");
  });

  test("refuses org admins and the owner", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const orgAdminId = await addMember(t, org, "admin", "admin");
    await expect(
      as(t, org.ownerId).mutation(api.engineMembers.remove, { instanceId: org.instanceId, targetUserId: orgAdminId })
    ).rejects.toMatchObject({ data: { code: "org_admin_has_every_engine" } });
    await expect(
      as(t, orgAdminId).mutation(api.engineMembers.remove, { instanceId: org.instanceId, targetUserId: org.ownerId })
    ).rejects.toThrow("always owns");
  });
});

describe("accountMembers.updateMemberRole", () => {
  test("promotion to org admin grants engine admin on every engine (I4)", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const otherId = await t.run((ctx) =>
      ctx.db.insert("instances", { accountId: org.accountId, name: "Second", url: "https://two.example", createdAt: 1 })
    );
    const memberId = await addMember(t, org, "member", "member");
    await as(t, org.ownerId).mutation(api.accountMembers.updateMemberRole, {
      accountId: org.accountId,
      targetUserId: memberId,
      role: "admin",
    });
    expect(await engineRole(t, org.instanceId, memberId)).toBe("admin");
    expect(await engineRole(t, otherId, memberId)).toBe("admin");
  });

  test("demotion to member lowers engine admin rows and keeps access", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const otherId = await t.run((ctx) =>
      ctx.db.insert("instances", { accountId: org.accountId, name: "Second", url: "https://two.example", createdAt: 1 })
    );
    const adminId = await addMember(t, org, "admin", "admin");
    await as(t, org.ownerId).mutation(api.accountMembers.updateMemberRole, {
      accountId: org.accountId,
      targetUserId: adminId,
      role: "member",
    });
    expect(await engineRole(t, org.instanceId, adminId)).toBe("member");
    expect(await engineRole(t, otherId, adminId)).toBeNull();
  });
});

describe("instances.create", () => {
  test("grants the owner and org admins, not every member (I5)", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addMember(t, org, "admin", "admin");
    const memberId = await addMember(t, org, "member", "member");
    const instanceId = await as(t, org.ownerId).mutation(api.instances.create, {
      accountId: org.accountId,
      name: "Second",
      url: "https://two.example",
    });
    expect(await engineRole(t, instanceId, org.ownerId)).toBe("owner");
    expect(await engineRole(t, instanceId, adminId)).toBe("admin");
    expect(await engineRole(t, instanceId, memberId)).toBeNull();
  });

  test.each<[string, OrgRole]>([
    ["an org admin", "admin"],
    ["an org member", "member"],
  ])("refuses %s with the org's createEngine refusal", async (_case, role) => {
    const t = newBackend();
    const org = await seedOrg(t);
    const userId = await addMember(t, org, role, "admin");
    await expect(
      as(t, userId).mutation(api.instances.create, { accountId: org.accountId, name: "Second", url: "two.example" })
    ).rejects.toMatchObject({ data: { code: "not_authorized", action: "createEngine" } });
  });
});

describe("provisioningInternal.reserveManagedInstance", () => {
  test("refuses an org admin with the org's createEngine refusal", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addMember(t, org, "admin", "admin");
    await expect(
      t.mutation(internal.provisioningInternal.reserveManagedInstance, {
        accountId: org.accountId,
        userId: adminId,
        slug: "org",
        newRegistrationToken: "token",
        newCreateRequestId: "request",
      })
    ).rejects.toMatchObject({ data: { code: "not_authorized", action: "createEngine" } });
  });
});
