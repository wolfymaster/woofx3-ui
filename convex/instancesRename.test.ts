import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import { ENGINE_NAME_MAX_LENGTH } from "./instances";
import { newBackend } from "./lib/convexTest.testing";

async function fixture() {
  const t = newBackend();
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const memberId = await ctx.db.insert("users", { name: "Member" });
    const adminId = await ctx.db.insert("users", { name: "Admin" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    await ctx.db.insert("instanceMembers", { instanceId, userId: memberId, role: "member" });
    await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
    await ctx.db.insert("instanceMembers", { instanceId, userId: adminId, role: "admin" });
    return { ownerId, memberId, adminId, instanceId };
  });
  const as = (userId: typeof ids.ownerId) => t.withIdentity({ subject: `${userId}|session` });
  return { t, instanceId: ids.instanceId, owner: as(ids.ownerId), member: as(ids.memberId), admin: as(ids.adminId) };
}

describe("instances.update name", () => {
  test("an owner renames the engine and the name is trimmed", async () => {
    const f = await fixture();
    await f.owner.mutation(api.instances.update, { instanceId: f.instanceId, name: "  Studio  " });
    const row = await f.t.run((ctx) => ctx.db.get(f.instanceId));
    expect(row?.name).toBe("Studio");
  });

  test("a blank name is refused", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.instances.update, { instanceId: f.instanceId, name: "   " })
    ).rejects.toMatchObject({
      data: { code: "invalid_name" },
    });
  });

  test("a name over the cap is refused", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.instances.update, { instanceId: f.instanceId, name: "x".repeat(ENGINE_NAME_MAX_LENGTH + 1) })
    ).rejects.toMatchObject({ data: { code: "invalid_name" } });
    await f.owner.mutation(api.instances.update, {
      instanceId: f.instanceId,
      name: "x".repeat(ENGINE_NAME_MAX_LENGTH),
    });
  });

  test("a plain member cannot rename", async () => {
    const f = await fixture();
    await expect(f.member.mutation(api.instances.update, { instanceId: f.instanceId, name: "X" })).rejects.toThrow(
      "Not authorized"
    );
  });

  test("an organization admin cannot rename, but still changes the address", async () => {
    const f = await fixture();
    await expect(f.admin.mutation(api.instances.update, { instanceId: f.instanceId, name: "X" })).rejects.toThrow(
      "doesn't allow this"
    );
    await f.admin.mutation(api.instances.update, { instanceId: f.instanceId, url: "https://other.example" });
    const row = await f.t.run((ctx) => ctx.db.get(f.instanceId));
    expect(row?.name).toBe("Main");
    expect(row?.url).toBe("https://other.example");
  });
});
