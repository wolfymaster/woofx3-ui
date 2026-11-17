import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";

async function fixture() {
  const t = newBackend();
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const adminId = await ctx.db.insert("users", { name: "Admin" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
    const external = await ctx.db.insert("instances", {
      accountId,
      name: "Own",
      url: "https://engine.example.com",
      hosting: "external",
      clientId: "client",
      clientSecret: "secret",
      webhookSecret: "hook",
      createdAt: 1,
    });
    const managed = await ctx.db.insert("instances", {
      accountId,
      name: "Hosted",
      url: "https://hosted.woofx3.test",
      hosting: "managed",
      clientId: "client",
      clientSecret: "secret",
      createdAt: 1,
    });
    for (const instanceId of [external, managed]) {
      await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
      await ctx.db.insert("instanceMembers", { instanceId, userId: adminId, role: "admin" });
    }
    return { ownerId, adminId, external, managed };
  });
  const as = (userId: Id<"users">) => t.withIdentity({ subject: `${userId}|session` });
  return { t, ...ids, owner: as(ids.ownerId), admin: as(ids.adminId) };
}

describe("instances.update url", () => {
  test("an engine admin who is not the org owner cannot move an external engine", async () => {
    const f = await fixture();
    await expect(
      f.admin.mutation(api.instances.update, { instanceId: f.external, url: "https://attacker.example.net" })
    ).rejects.toMatchObject({ data: { code: "not_authorized", action: "changeEngineUrl" } });
    expect((await f.t.run((ctx) => ctx.db.get(f.external)))?.url).toBe("https://engine.example.com");
  });

  test("nobody can move a managed engine, the owner included", async () => {
    const f = await fixture();
    for (const who of [f.owner, f.admin]) {
      await expect(
        who.mutation(api.instances.update, { instanceId: f.managed, url: "https://attacker.example.net" })
      ).rejects.toMatchObject({ data: { code: "managed_engine_url" } });
    }
    expect((await f.t.run((ctx) => ctx.db.get(f.managed)))?.url).toBe("https://hosted.woofx3.test");
  });

  test("the owner's new address is validated", async () => {
    const f = await fixture();
    for (const url of ["http://engine.example.com", "https://127.0.0.1", "https://169.254.169.254/latest"]) {
      await expect(f.owner.mutation(api.instances.update, { instanceId: f.external, url })).rejects.toMatchObject({
        data: { code: "invalid_url" },
      });
    }
  });

  test("the owner moves an external engine and its old credentials are dropped", async () => {
    const f = await fixture();
    await f.owner.mutation(api.instances.update, { instanceId: f.external, url: " https://new.example.com " });
    const row = await f.t.run((ctx) => ctx.db.get(f.external));
    expect(row?.url).toBe("https://new.example.com");
    expect(row?.clientId).toBeUndefined();
    expect(row?.clientSecret).toBeUndefined();
    expect(row?.webhookSecret).toBeUndefined();
  });

  test("saving the same address keeps the credentials", async () => {
    const f = await fixture();
    await f.owner.mutation(api.instances.update, { instanceId: f.external, url: "https://engine.example.com" });
    const row = await f.t.run((ctx) => ctx.db.get(f.external));
    expect(row?.clientSecret).toBe("secret");
  });
});
