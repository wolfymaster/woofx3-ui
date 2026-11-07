import { describe, expect, test } from "bun:test";
import { Password } from "@convex-dev/auth/providers/Password";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";

async function fixture() {
  const t = newBackend();
  const ids = await t.run(async (ctx) => {
    const passwordUserId = await ctx.db.insert("users", { name: "Pat", email: "pat@example.com" });
    const twitchUserId = await ctx.db.insert("users", { name: "Streamer" });
    await ctx.db.insert("authAccounts", {
      userId: passwordUserId,
      provider: "password",
      providerAccountId: "pat@example.com",
    });
    await ctx.db.insert("authAccounts", { userId: twitchUserId, provider: "twitch", providerAccountId: "123" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId: passwordUserId, createdAt: 1 });
    const engine = (name: string) =>
      ctx.db.insert("instances", { accountId, name, url: "https://e.example", hosting: "managed", createdAt: 1 });
    const mine = await engine("Mine");
    const other = await engine("Other");
    await ctx.db.insert("instanceMembers", { instanceId: mine, userId: passwordUserId, role: "owner" });
    return { passwordUserId, twitchUserId, mine, other };
  });
  const as = (userId: Id<"users">) => t.withIdentity({ subject: `${userId}|session` });
  return { t, ...ids, pat: as(ids.passwordUserId), streamer: as(ids.twitchUserId) };
}

describe("userSettings", () => {
  test("a default engine is stored and read back", async () => {
    const f = await fixture();
    await f.pat.mutation(api.userSettings.setDefaultEngine, { instanceId: f.mine });
    expect(await f.pat.query(api.userSettings.getMine, {})).toEqual({ defaultInstanceId: f.mine });
  });

  test("setting twice updates the one row, and null clears it", async () => {
    const f = await fixture();
    await f.pat.mutation(api.userSettings.setDefaultEngine, { instanceId: f.mine });
    await f.pat.mutation(api.userSettings.setDefaultEngine, { instanceId: null });
    expect(await f.pat.query(api.userSettings.getMine, {})).toEqual({ defaultInstanceId: null });
    const rows = await f.t.run((ctx) => ctx.db.query("userSettings").collect());
    expect(rows).toHaveLength(1);
  });

  test("an engine the user is not a member of is refused", async () => {
    const f = await fixture();
    await expect(f.pat.mutation(api.userSettings.setDefaultEngine, { instanceId: f.other })).rejects.toThrow(
      "Not authorized"
    );
  });

  test("a stale default (access lost) reads as none", async () => {
    const f = await fixture();
    await f.pat.mutation(api.userSettings.setDefaultEngine, { instanceId: f.mine });
    await f.t.run(async (ctx) => {
      const membership = await ctx.db.query("instanceMembers").first();
      if (membership) {
        await ctx.db.delete(membership._id);
      }
    });
    expect(await f.pat.query(api.userSettings.getMine, {})).toEqual({ defaultInstanceId: null });
  });

  test("a deleted engine reads as none", async () => {
    const f = await fixture();
    await f.pat.mutation(api.userSettings.setDefaultEngine, { instanceId: f.mine });
    await f.t.run(async (ctx) => {
      await ctx.db.delete(f.mine);
    });
    expect(await f.pat.query(api.userSettings.getMine, {})).toEqual({ defaultInstanceId: null });
  });
});

describe("users profile", () => {
  test("a password user renames themself, trimmed", async () => {
    const f = await fixture();
    await f.pat.mutation(api.users.updateProfile, { name: "  Patricia " });
    expect((await f.pat.query(api.users.getMe, {}))?.name).toBe("Patricia");
  });

  test("blank and overlong names are refused", async () => {
    const f = await fixture();
    await expect(f.pat.mutation(api.users.updateProfile, { name: "  " })).rejects.toThrow("display name");
    await expect(f.pat.mutation(api.users.updateProfile, { name: "x".repeat(101) })).rejects.toThrow("display name");
  });

  test("a Twitch-only user keeps the Twitch name", async () => {
    const f = await fixture();
    await expect(f.streamer.mutation(api.users.updateProfile, { name: "Someone Else" })).rejects.toThrow("Twitch");
  });

  test("sign-in methods tell a password user from a Twitch-only user", async () => {
    const f = await fixture();
    expect(await f.pat.query(api.users.signInMethods, {})).toEqual({ password: true, twitch: false });
    expect(await f.streamer.query(api.users.signInMethods, {})).toEqual({ password: false, twitch: true });
  });

  test("a Twitch-only user has no password to change", async () => {
    const f = await fixture();
    const result = await f.streamer.action(api.users.changePassword, {
      currentPassword: "a",
      newPassword: "longenough1",
    });
    expect(result).toEqual({ ok: false, reason: "no_password" });
  });

  test("a wrong current password is refused, and repeated failures are rate limited", async () => {
    const f = await fixture();
    const attempt = () =>
      f.pat.action(api.users.changePassword, { currentPassword: "wrong", newPassword: "longenough1" });
    expect(await attempt()).toEqual({ ok: false, reason: "wrong_password" });
    await f.t.run(async (ctx) => {
      const account = await ctx.db.query("authAccounts").first();
      if (account === null) {
        throw new Error("fixture has no auth account");
      }
      const limit = await ctx.db
        .query("authRateLimits")
        .withIndex("identifier", (q) => q.eq("identifier", account._id))
        .unique();
      if (limit === null) {
        throw new Error("a failed attempt records a rate limit row");
      }
      await ctx.db.patch(limit._id, { attemptsLeft: 0 });
    });
    expect(await attempt()).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  test("a successful change keeps this session and ends every other one", async () => {
    const f = await fixture();
    const sessions = await f.t.run(async (ctx) => {
      const account = await ctx.db.query("authAccounts").first();
      if (account === null) {
        throw new Error("fixture has no auth account");
      }
      const hashSecret = Password().options.crypto?.hashSecret;
      if (hashSecret === undefined) {
        throw new Error("the Password provider has no hasher");
      }
      await ctx.db.patch(account._id, { secret: await hashSecret("oldpassword1") });
      const session = () =>
        ctx.db.insert("authSessions", { userId: f.passwordUserId, expirationTime: Date.now() + 60_000 });
      return { current: await session(), desktop: await session() };
    });
    const pat = f.t.withIdentity({ subject: `${f.passwordUserId}|${sessions.current}` });
    const result = await pat.action(api.users.changePassword, {
      currentPassword: "oldpassword1",
      newPassword: "newpassword1",
    });
    expect(result).toEqual({ ok: true });
    const left = await f.t.run((ctx) => ctx.db.query("authSessions").collect());
    expect(left.map((row) => row._id)).toEqual([sessions.current]);
  });

  test("a too-short new password is refused before the old one is checked", async () => {
    const f = await fixture();
    const result = await f.pat.action(api.users.changePassword, { currentPassword: "a", newPassword: "short" });
    expect(result).toEqual({ ok: false, reason: "weak_password" });
  });
});
