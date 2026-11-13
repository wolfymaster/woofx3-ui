import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import { newBackend } from "./lib/convexTest.testing";

describe("instances.listForCurrentUser ownedByMe", () => {
  test("an invitee's engine is not theirs until they own an organization's engine", async () => {
    const t = newBackend();
    const { streamerId, inviteeId, streamerEngineId, inviteeEngineId } = await t.run(async (ctx) => {
      const streamerId = await ctx.db.insert("users", { name: "Streamer" });
      const inviteeId = await ctx.db.insert("users", { name: "Invitee" });
      const streamerAccount = await ctx.db.insert("accounts", { name: "Streamer", ownerId: streamerId, createdAt: 1 });
      const inviteeAccount = await ctx.db.insert("accounts", { name: "Invitee", ownerId: inviteeId, createdAt: 1 });
      const streamerEngineId = await ctx.db.insert("instances", {
        accountId: streamerAccount,
        name: "Streamer engine",
        url: "https://s.example",
        hosting: "managed",
        createdAt: 1,
      });
      const inviteeEngineId = await ctx.db.insert("instances", {
        accountId: inviteeAccount,
        name: "Invitee engine",
        url: "https://i.example",
        hosting: "managed",
        createdAt: 2,
      });
      await ctx.db.insert("instanceMembers", { instanceId: streamerEngineId, userId: streamerId, role: "owner" });
      await ctx.db.insert("instanceMembers", { instanceId: streamerEngineId, userId: inviteeId, role: "member" });
      return { streamerId, inviteeId, streamerEngineId, inviteeEngineId };
    });
    const as = (userId: typeof streamerId) => t.withIdentity({ subject: `${userId}|session` });

    const invitedOnly = await as(inviteeId).query(api.instances.listForCurrentUser, {});
    expect(invitedOnly.map((engine) => [engine._id, engine.ownedByMe])).toEqual([[streamerEngineId, false]]);

    await t.run((ctx) =>
      ctx.db.insert("instanceMembers", { instanceId: inviteeEngineId, userId: inviteeId, role: "owner" })
    );
    const both = await as(inviteeId).query(api.instances.listForCurrentUser, {});
    expect(Object.fromEntries(both.map((engine) => [engine._id, engine.ownedByMe]))).toEqual({
      [streamerEngineId]: false,
      [inviteeEngineId]: true,
    });

    const owner = await as(streamerId).query(api.instances.listForCurrentUser, {});
    expect(owner.map((engine) => engine.ownedByMe)).toEqual([true]);
  });
});
