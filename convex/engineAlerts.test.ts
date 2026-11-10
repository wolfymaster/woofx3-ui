import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

async function seedMember(t: Backend): Promise<{ instanceId: Id<"instances">; userId: Id<"users"> }> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId: userId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId, role: "owner" });
    return { instanceId, userId };
  });
}

describe("listForInstance", () => {
  test("returns only the fields the alert list's readers use", async () => {
    const t = newBackend();
    const { instanceId, userId } = await seedMember(t);
    await t.run((ctx) =>
      ctx.db.insert("engineAlerts", {
        instanceId,
        engineAlertId: "alert-1",
        payload: '{"text":"hi"}',
        workflowId: "wf-1",
        sourceEventId: "event-1",
        status: "completed",
        envelopeId: "env-1",
        dispatchedAt: "2026-11-07T10:00:00Z",
        playedAt: "2026-11-07T10:00:01Z",
        completedAt: "2026-11-07T10:00:05Z",
        engineCreatedAt: "2026-11-07T10:00:00Z",
        engineUpdatedAt: "2026-11-07T10:00:05Z",
        engineVersion: 4,
        createdAt: 1,
        progressedAt: 2,
      })
    );
    const rows = await t.withIdentity({ subject: `${userId}|session` }).query(api.engineAlerts.listForInstance, {
      instanceId,
    });
    expect(rows).toEqual([
      {
        _id: rows[0]._id,
        engineAlertId: "alert-1",
        status: "completed",
        payload: '{"text":"hi"}',
        workflowId: "wf-1",
        sourceEventId: "event-1",
        engineCreatedAt: "2026-11-07T10:00:00Z",
        createdAt: 1,
      },
    ]);
  });
});
