import { describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend, runMigration } from "./lib/convexTest.testing";
import { accountEntitlements, SEATS_FULL } from "./lib/entitlementAccess";
import type { EngineRole, OrgRole } from "./lib/organization";
import { insertProjection } from "./lib/orgBilling.testing";
import { seedMissingTierPlans } from "./seeds/plans";

type Backend = ReturnType<typeof newBackend>;

interface Org {
  accountId: Id<"accounts">;
  ownerId: Id<"users">;
  instanceId: Id<"instances">;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedOrg(t: Backend): Promise<Org> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner", email: "owner@example.com" });
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

async function addEngine(t: Backend, org: Org, name: string): Promise<Id<"instances">> {
  return t.run(async (ctx) => {
    const instanceId = await ctx.db.insert("instances", {
      accountId: org.accountId,
      name,
      url: `https://${name}.example`,
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: org.ownerId, role: "owner" });
    return instanceId;
  });
}

async function addUser(
  t: Backend,
  email: string,
  membership?: { org: Org; orgRole: OrgRole; engineRole: EngineRole | null }
): Promise<Id<"users">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email, email });
    if (membership) {
      const { org, orgRole, engineRole } = membership;
      await ctx.db.insert("accountMembers", { accountId: org.accountId, userId, role: orgRole, createdAt: 1 });
      if (engineRole !== null) {
        await ctx.db.insert("instanceMembers", { instanceId: org.instanceId, userId, role: engineRole });
      }
    }
    return userId;
  });
}

function as(t: Backend, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session` });
}

async function invite(t: Backend, inviterId: Id<"users">, instanceId: Id<"instances">, email: string) {
  return as(t, inviterId).action(api.invitations.create, {
    instanceId,
    engineRole: "member",
    target: { kind: "email", email },
  });
}

async function legacyInvite(t: Backend, org: Org, email: string, role: "admin" | "member", expiresAt?: number) {
  return t.run((ctx) =>
    ctx.db.insert("invitations", {
      accountId: org.accountId,
      email,
      role,
      token: `legacy-${email}`,
      invitedByUserId: org.ownerId,
      status: "pending",
      expiresAt: expiresAt ?? Date.now() + DAY_MS,
      createdAt: 1,
    })
  );
}

async function roles(t: Backend, org: Org, userId: Id<"users">, instanceId: Id<"instances">) {
  return t.run(async (ctx) => {
    const orgRow = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) => q.eq("accountId", org.accountId).eq("userId", userId))
      .unique();
    const engineRow = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
      .unique();
    return { org: orgRow?.role ?? null, engine: engineRow?.role ?? null };
  });
}

/** Puts the org on a Starter trial with a hosted engine, then takes every seat the plan has. */
async function fillSeats(t: Backend, org: Org): Promise<void> {
  await t.run(async (ctx) => {
    await seedMissingTierPlans(ctx, "test");
    await ctx.db.patch(org.instanceId, { hosting: "managed" });
    await insertProjection(ctx, org.accountId, { standing: "trialing", trialEndsAt: Date.now() + 30 * DAY_MS });
  });
  const { limits } = await t.run((ctx) => accountEntitlements(ctx, org.accountId, Date.now()));
  const limit = limits["org.members"];
  if (typeof limit !== "number") {
    throw new Error("the Starter plan has no seat limit");
  }
  for (let seat = 1; seat < limit; seat += 1) {
    await addUser(t, `seat${seat}@example.com`, { org, orgRole: "member", engineRole: null });
  }
}

describe("invitations.create", () => {
  test("an engine admin invites to that engine with org role member", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addUser(t, "admin@example.com", { org, orgRole: "member", engineRole: "admin" });
    await invite(t, adminId, org.instanceId, "new@example.com");
    const rows = await t.run((ctx) => ctx.db.query("invitations").collect());
    expect(rows.map((r) => [r.instanceId, r.engineRole, r.role])).toEqual([[org.instanceId, "member", "member"]]);
  });

  test("an engine member may not invite", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const memberId = await addUser(t, "member@example.com", { org, orgRole: "member", engineRole: "member" });
    await expect(invite(t, memberId, org.instanceId, "new@example.com")).rejects.toThrow("Not authorized");
  });

  test("refuses someone already on the engine, but not an org member who isn't", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await addUser(t, "on@example.com", { org, orgRole: "member", engineRole: "member" });
    await addUser(t, "off@example.com", { org, orgRole: "member", engineRole: null });
    await expect(invite(t, org.ownerId, org.instanceId, "on@example.com")).rejects.toMatchObject({
      data: { code: "already_on_engine", message: "That user is already on this engine" },
    });
    await invite(t, org.ownerId, org.instanceId, "off@example.com");
  });
});

describe("invitations.create refusals", () => {
  test("a full org refuses a new invitee with a message the client can show", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await fillSeats(t, org);
    await expect(invite(t, org.ownerId, org.instanceId, "new@example.com")).rejects.toMatchObject({
      data: { code: "seats_full", message: SEATS_FULL },
    });
  });
});

describe("invitations.create refusals hide member emails from non-owners", () => {
  const REFUSED = { code: "invite_refused" };

  test.each<[string, OrgRole]>([
    ["an org admin", "admin"],
    ["an engine admin who is an org member", "member"],
  ])("%s gets the same refusal for an address already on the engine", async (_case, orgRole) => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addUser(t, "admin@example.com", { org, orgRole, engineRole: "admin" });
    await addUser(t, "on@example.com", { org, orgRole: "member", engineRole: "member" });
    await expect(invite(t, adminId, org.instanceId, "on@example.com")).rejects.toMatchObject({ data: REFUSED });
  });

  test.each<[string, OrgRole]>([
    ["an org admin", "admin"],
    ["an engine admin who is an org member", "member"],
  ])("%s with seats full can't tell a member's address from a stranger's", async (_case, orgRole) => {
    const t = newBackend();
    const org = await seedOrg(t);
    const adminId = await addUser(t, "admin@example.com", { org, orgRole, engineRole: "admin" });
    await fillSeats(t, org);
    await expect(invite(t, adminId, org.instanceId, "seat1@example.com")).rejects.toMatchObject({ data: REFUSED });
    await expect(invite(t, adminId, org.instanceId, "stranger@example.com")).rejects.toMatchObject({
      data: REFUSED,
    });
  });

  test("the owner with seats full still invites an org member who isn't on the engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await fillSeats(t, org);
    await invite(t, org.ownerId, org.instanceId, "seat1@example.com");
  });
});

describe("invitations.listForEngine", () => {
  async function listedEmails(t: Backend, userId: Id<"users">, instanceId: Id<"instances">) {
    const result = await as(t, userId).query(api.invitations.listForEngine, { instanceId, now: Date.now() });
    return result === null ? null : result.invitations.map((i) => i.email).sort();
  }

  test("an engine admin sees only that engine's invitations", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const secondId = await addEngine(t, org, "second");
    const adminId = await addUser(t, "admin@example.com", { org, orgRole: "member", engineRole: "admin" });
    await invite(t, org.ownerId, org.instanceId, "here@example.com");
    await invite(t, org.ownerId, secondId, "there@example.com");
    await legacyInvite(t, org, "orgwide@example.com", "member");
    expect(await listedEmails(t, adminId, org.instanceId)).toEqual(["here@example.com"]);
  });

  test("an engine member sees no invitations", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const memberId = await addUser(t, "member@example.com", { org, orgRole: "member", engineRole: "member" });
    await invite(t, org.ownerId, org.instanceId, "here@example.com");
    expect(await listedEmails(t, memberId, org.instanceId)).toBeNull();
  });

  test("manageMembers also sees the org-wide invitations, but not expired ones", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await invite(t, org.ownerId, org.instanceId, "here@example.com");
    await legacyInvite(t, org, "orgwide@example.com", "member");
    await legacyInvite(t, org, "stale@example.com", "member", 1);
    expect(await listedEmails(t, org.ownerId, org.instanceId)).toEqual(["here@example.com", "orgwide@example.com"]);
  });
});

describe("invitations.accept", () => {
  test("a new user joins the org as a member and gets only the invited engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const secondId = await addEngine(t, org, "second");
    const { token } = await invite(t, org.ownerId, org.instanceId, "new@example.com");
    const userId = await addUser(t, "new@example.com");
    const result = await as(t, userId).mutation(api.invitations.accept, { token });
    expect(result).toMatchObject({ instanceId: org.instanceId, alreadyMember: false });
    expect(await roles(t, org, userId, org.instanceId)).toEqual({ org: "member", engine: "member" });
    expect((await roles(t, org, userId, secondId)).engine).toBeNull();
  });

  test("an existing org member accepting gets the engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const secondId = await addEngine(t, org, "second");
    const userId = await addUser(t, "member@example.com", { org, orgRole: "member", engineRole: "member" });
    const { token } = await invite(t, org.ownerId, secondId, "member@example.com");
    const result = await as(t, userId).mutation(api.invitations.accept, { token });
    expect(result).toMatchObject({ instanceId: secondId, alreadyMember: true });
    expect(await roles(t, org, userId, secondId)).toEqual({ org: "member", engine: "member" });
  });

  test("accepting a member invitation never lowers an engine admin", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const { token } = await invite(t, org.ownerId, org.instanceId, "late@example.com");
    // Made an engine admin by another route after the invitation was sent.
    const userId = await addUser(t, "late@example.com", { org, orgRole: "member", engineRole: "admin" });
    await as(t, userId).mutation(api.invitations.accept, { token });
    expect(await roles(t, org, userId, org.instanceId)).toEqual({ org: "member", engine: "admin" });
  });

  test("an expired invitation is reported, and grants nothing", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await legacyInvite(t, org, "late@example.com", "member", Date.now() - 1);
    const userId = await addUser(t, "late@example.com");
    const result = await as(t, userId).mutation(api.invitations.accept, { token: "legacy-late@example.com" });
    expect(result).toEqual({ status: "expired" });
    expect((await roles(t, org, userId, org.instanceId)).org).toBeNull();
  });

  test("an unknown token is not_found", async () => {
    const t = newBackend();
    const userId = await addUser(t, "someone@example.com");
    expect(await as(t, userId).mutation(api.invitations.accept, { token: "nope" })).toEqual({ status: "not_found" });
  });

  test("a revoked invitation is reported, and grants nothing", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const { token } = await invite(t, org.ownerId, org.instanceId, "new@example.com");
    const [row] = await t.run((ctx) => ctx.db.query("invitations").collect());
    await as(t, org.ownerId).mutation(api.invitations.revoke, { invitationId: row._id });
    const userId = await addUser(t, "new@example.com");
    expect(await as(t, userId).mutation(api.invitations.accept, { token })).toEqual({ status: "revoked" });
    expect((await roles(t, org, userId, org.instanceId)).engine).toBeNull();
  });

  test("opening a used link again is already_member for someone on the engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const { token } = await invite(t, org.ownerId, org.instanceId, "new@example.com");
    const userId = await addUser(t, "new@example.com");
    await as(t, userId).mutation(api.invitations.accept, { token });
    expect(await as(t, userId).mutation(api.invitations.accept, { token })).toEqual({
      status: "already_member",
      instanceId: org.instanceId,
    });
  });

  test("a used link is already_accepted for someone who is not on the engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const { token } = await invite(t, org.ownerId, org.instanceId, "new@example.com");
    const userId = await addUser(t, "new@example.com");
    await as(t, userId).mutation(api.invitations.accept, { token });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("instanceMembers")
        .withIndex("by_instance_user", (q) => q.eq("instanceId", org.instanceId).eq("userId", userId))
        .unique();
      if (row) {
        await ctx.db.delete(row._id);
      }
    });
    expect(await as(t, userId).mutation(api.invitations.accept, { token })).toEqual({ status: "already_accepted" });
  });

  test("an org-wide admin invitation makes an org admin with engine admin", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await legacyInvite(t, org, "boss@example.com", "admin");
    const userId = await addUser(t, "boss@example.com");
    await as(t, userId).mutation(api.invitations.accept, { token: "legacy-boss@example.com" });
    expect(await roles(t, org, userId, org.instanceId)).toEqual({ org: "admin", engine: "admin" });
  });

  test("a full org is seats_full, and grants nothing", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const { token } = await invite(t, org.ownerId, org.instanceId, "new@example.com");
    await fillSeats(t, org);
    const userId = await addUser(t, "new@example.com");
    expect(await as(t, userId).mutation(api.invitations.accept, { token })).toEqual({ status: "seats_full" });
    expect(await roles(t, org, userId, org.instanceId)).toEqual({ org: null, engine: null });
  });

  test("a full org still lets an existing org member accept", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const userId = await addUser(t, "member@example.com", { org, orgRole: "member", engineRole: null });
    const { token } = await invite(t, org.ownerId, org.instanceId, "member@example.com");
    await fillSeats(t, org);
    expect(await as(t, userId).mutation(api.invitations.accept, { token })).toMatchObject({ status: "accepted" });
  });

  test("the wrong account is wrong_account with whom to sign in as, and grants nothing", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const { token } = await invite(t, org.ownerId, org.instanceId, "new@example.com");
    const userId = await addUser(t, "other@example.com");
    expect(await as(t, userId).mutation(api.invitations.accept, { token })).toEqual({
      status: "wrong_account",
      message: "Sign in with the email address this invitation was sent to",
    });
    expect((await roles(t, org, userId, org.instanceId)).org).toBeNull();
  });

  test("an invitation to a deleted engine is engine_gone", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const { token } = await invite(t, org.ownerId, org.instanceId, "new@example.com");
    await t.run((ctx) => ctx.db.delete(org.instanceId));
    const userId = await addUser(t, "new@example.com");
    expect(await as(t, userId).mutation(api.invitations.accept, { token })).toEqual({ status: "engine_gone" });
  });

  test("the preview names the engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const { token } = await invite(t, org.ownerId, org.instanceId, "new@example.com");
    const preview = await t.query(api.invitations.previewByToken, { token });
    expect(preview).toMatchObject({ accountName: "Org", engineName: "Main" });
  });
});

describe("migration invitationEngineTarget (M4)", () => {
  test("targets the registered engine, expires invites of orgs without one, and is idempotent", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await addEngine(t, org, "unregistered");
    const legacyId = await legacyInvite(t, org, "a@example.com", "admin");
    const empty = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Lonely" });
      const accountId = await ctx.db.insert("accounts", { name: "Empty", ownerId, createdAt: 1 });
      return ctx.db.insert("invitations", {
        accountId,
        email: "b@example.com",
        role: "member",
        token: "empty",
        invitedByUserId: ownerId,
        status: "pending",
        expiresAt: Date.now() + DAY_MS,
        createdAt: 1,
      });
    });
    const snapshot = () =>
      t.run(async (ctx) => ({ legacy: await ctx.db.get(legacyId), empty: await ctx.db.get(empty) }));

    await runMigration(t, internal.migrations.invitations.invitationEngineTarget);
    const first = await snapshot();
    expect(first.legacy).toMatchObject({ instanceId: org.instanceId, engineRole: "admin", status: "pending" });
    expect(first.empty?.status).toBe("expired");

    await runMigration(t, internal.migrations.invitations.invitationEngineTarget);
    expect(await snapshot()).toEqual(first);
  });
});
