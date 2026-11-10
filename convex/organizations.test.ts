import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import type { EngineRole, OrgRole } from "./lib/organization";
import { insertProjection } from "./lib/orgBilling.testing";
import { seedMissingTierPlans } from "./seeds/plans";

type Backend = ReturnType<typeof newBackend>;

interface Org {
  accountId: Id<"accounts">;
  ownerId: Id<"users">;
  hostedId: Id<"instances">;
  selfHostedId: Id<"instances">;
}

const NOW = Date.UTC(2026, 10, 1);
const DAY = 24 * 60 * 60 * 1000;

/** An org with a trialing projection, a hosted engine and a self-hosted one, both owned by its owner. */
async function seedOrg(t: Backend): Promise<Org> {
  return t.run(async (ctx) => {
    await seedMissingTierPlans(ctx, "test");
    const ownerId = await ctx.db.insert("users", { name: "Owner", email: "owner@example.com" });
    const accountId = await ctx.db.insert("accounts", { name: "Wolfy Streams", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    const hostedId = await ctx.db.insert("instances", {
      accountId,
      name: "Hosted",
      url: "https://hosted.example",
      hosting: "managed",
      createdAt: 1,
    });
    const selfHostedId = await ctx.db.insert("instances", {
      accountId,
      name: "LAN Box",
      url: "https://lan.example",
      hosting: "external",
      createdAt: 1,
    });
    for (const instanceId of [hostedId, selfHostedId]) {
      await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    }
    await insertProjection(ctx, accountId, { standing: "trialing", trialEndsAt: NOW + 30 * DAY });
    return { accountId, ownerId, hostedId, selfHostedId };
  });
}

async function addMember(t: Backend, org: Org, orgRole: OrgRole, engineRole: EngineRole | null) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: orgRole, email: `${orgRole}@example.com` });
    await ctx.db.insert("accountMembers", { accountId: org.accountId, userId, role: orgRole, createdAt: 1 });
    if (engineRole !== null) {
      await ctx.db.insert("instanceMembers", { instanceId: org.hostedId, userId, role: engineRole });
    }
    return userId;
  });
}

function as(t: Backend, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session` });
}

async function mine(t: Backend, userId: Id<"users">) {
  const [organization] = await as(t, userId).query(api.organizations.mine, { now: NOW });
  return organization;
}

describe("organizations.mine", () => {
  test("the owner sees the plan, seats and every engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const organization = await mine(t, org.ownerId);
    expect(organization).toMatchObject({ name: "Wolfy Streams", role: "owner", seats: { used: 1 } });
    expect(organization.subscription).toMatchObject({ plan: "starter", state: "trialing" });
    expect(organization.can.manageBilling).toBe(true);
    expect(organization.engines.map((e) => [e.name, e.hosting]).sort()).toEqual([
      ["Hosted", "managed"],
      ["LAN Box", "external"],
    ]);
  });

  test("seats have the plan's limit once the org has a hosted engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    expect((await mine(t, org.ownerId)).seats).toEqual({ used: 1, limit: 5 });
  });

  test("seats have no limit for an org with only self-hosted engines", async () => {
    const t = newBackend();
    const ownerId = await t.run(async (ctx) => {
      await seedMissingTierPlans(ctx, "test");
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const accountId = await ctx.db.insert("accounts", { name: "LAN", ownerId, createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
      await ctx.db.insert("instances", {
        accountId,
        name: "LAN Box",
        url: "https://lan",
        hosting: "external",
        createdAt: 1,
      });
      for (let i = 0; i < 6; i++) {
        const userId = await ctx.db.insert("users", { name: `m${i}` });
        await ctx.db.insert("accountMembers", { accountId, userId, role: "member", createdAt: 1 });
      }
      return ownerId;
    });
    expect((await mine(t, ownerId)).seats).toEqual({ used: 7, limit: null });
  });

  test("an admin sees the plan but may not manage billing", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addMember(t, org, "admin", "admin");
    const organization = await mine(t, adminId);
    expect(organization.subscription?.state).toBe("trialing");
    expect(organization.can.manageBilling).toBe(false);
  });

  test("an admin sees and renames every engine, and no one is sent createEngine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addMember(t, org, "admin", "admin");
    const organization = await mine(t, adminId);
    expect(organization.can.manageEngines).toBe(true);
    expect(organization.engines.map((e) => e.name).sort()).toEqual(["Hosted", "LAN Box"]);
    // Creating is enforced by the server's engine paths, not offered by any screen.
    expect(organization.can).not.toHaveProperty("createEngine");
    expect((await mine(t, org.ownerId)).can).not.toHaveProperty("createEngine");
  });

  test("a member sees no billing or seats, and only the engines they're on", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const memberId = await addMember(t, org, "member", "member");
    const organization = await mine(t, memberId);
    expect(organization).toMatchObject({ role: "member", subscription: null, seats: null });
    expect(organization.engines.map((e) => e.name)).toEqual(["Hosted"]);
  });
});

describe("organizations.members", () => {
  test("lists members with their engines for an admin", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addMember(t, org, "admin", "admin");
    const members = await as(t, adminId).query(api.organizations.members, { accountId: org.accountId });
    const owner = members?.find((m) => m.userId === org.ownerId);
    expect(owner?.role).toBe("owner");
    expect(owner?.engines.map((e) => e.name).sort()).toEqual(["Hosted", "LAN Box"]);
  });

  test("answers null to a member", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const memberId = await addMember(t, org, "member", "member");
    expect(await as(t, memberId).query(api.organizations.members, { accountId: org.accountId })).toBeNull();
  });

  test("sends email addresses to the owner only", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addMember(t, org, "admin", "admin");
    const forOwner = await as(t, org.ownerId).query(api.organizations.members, { accountId: org.accountId });
    expect(forOwner?.find((m) => m.userId === adminId)?.email).toBe("admin@example.com");
    const forAdmin = await as(t, adminId).query(api.organizations.members, { accountId: org.accountId });
    expect(forAdmin?.length).toBe(2);
    for (const member of forAdmin ?? []) {
      expect("email" in member).toBe(false);
    }
  });

  test("names a member without a name by their linked platform name, else Member", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const [linkedId, plainId] = await t.run(async (ctx) => {
      const ids: Id<"users">[] = [];
      for (const email of ["linked@example.com", "plain@example.com"]) {
        const userId = await ctx.db.insert("users", { email });
        await ctx.db.insert("accountMembers", { accountId: org.accountId, userId, role: "member", createdAt: 1 });
        ids.push(userId);
      }
      await ctx.db.insert("platformLinks", {
        instanceId: org.hostedId,
        platform: "twitch",
        platformUserId: "123",
        platformUsername: "WolfyTV",
        channelId: "123",
        sealedAccessToken: "sealed",
        sealedRefreshToken: "sealed",
        expiresAt: 1,
        scopes: [],
        connectedByUserId: ids[0],
      });
      return ids;
    });
    const members = await as(t, org.ownerId).query(api.organizations.members, { accountId: org.accountId });
    expect(members?.find((m) => m.userId === linkedId)?.name).toBe("WolfyTV");
    expect(members?.find((m) => m.userId === plainId)?.name).toBe("Member");
  });
});

describe("organizations.rename", () => {
  test("an admin renames; a member and a blank name are refused", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addMember(t, org, "admin", "admin");
    const memberId = await addMember(t, org, "member", "member");
    await as(t, adminId).mutation(api.organizations.rename, { accountId: org.accountId, name: "  Mod Squad " });
    expect((await mine(t, org.ownerId)).name).toBe("Mod Squad");
    await expect(
      as(t, memberId).mutation(api.organizations.rename, { accountId: org.accountId, name: "Mine now" })
    ).rejects.toThrow("doesn't allow this");
    await expect(
      as(t, adminId).mutation(api.organizations.rename, { accountId: org.accountId, name: "   " })
    ).rejects.toThrow("1 to 64 characters");
  });
});
