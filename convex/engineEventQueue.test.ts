import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

const ENV = {
  CONVEX_SITE_URL: "https://deployment.convex.site",
  ENGINE_EVENTS_INGEST_URL: "https://maintenance.example/v1/engine-events",
  MAINTENANCE_API_URL: "https://maintenance.example",
  MAINTENANCE_API_KEY: "key",
};
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterAll(() => {
  for (const key of Object.keys(ENV)) {
    process.env[key] = saved[key];
  }
});

async function insertInstance(
  t: Backend,
  fields: { clientId?: string; eventsTargetSetAt?: number; name?: string }
): Promise<Id<"instances">> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    return ctx.db.insert("instances", {
      accountId,
      name: fields.name ?? "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
      ...(fields.clientId ? { clientId: fields.clientId, clientSecret: "secret" } : {}),
      ...(fields.eventsTargetSetAt === undefined ? {} : { eventsTargetSetAt: fields.eventsTargetSetAt }),
    });
  });
}

describe("moveToQueue", () => {
  test("an instance already on the queue is skipped without calling anything", async () => {
    const t = newBackend();
    const instanceId = await insertInstance(t, { clientId: "client", eventsTargetSetAt: 5 });
    expect(await t.action(internal.engineEventQueue.moveToQueue, { instanceId })).toBe("already_moved");
  });

  test("an unregistered instance is not moved", async () => {
    const t = newBackend();
    const instanceId = await insertInstance(t, {});
    expect(await t.action(internal.engineEventQueue.moveToQueue, { instanceId })).toBe("not_registered");
  });
});

describe("re-registration", () => {
  test("clears the moved mark, since the new client has no events target", async () => {
    const t = newBackend();
    const instanceId = await insertInstance(t, { clientId: "old", eventsTargetSetAt: 5 });
    await t.mutation(internal.instances.applyRegistration, {
      instanceId,
      clientId: "new",
      clientSecret: "secret",
      webhookSecret: "hook",
    });
    const instance = await t.run((ctx) => ctx.db.get(instanceId));
    expect(instance?.eventsTargetSetAt).toBeUndefined();
  });
});

describe("moveEnginesToEventQueue migration", () => {
  test("schedules a move only for registered instances not yet moved", async () => {
    const t = newBackend();
    const pending = await insertInstance(t, { clientId: "a" });
    await insertInstance(t, { clientId: "b", eventsTargetSetAt: 5 });
    await insertInstance(t, {});
    await t.mutation(internal.migrations.moveEnginesToEventQueue.batch, { cursor: null });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => [job.name, job.args[0]])).toEqual([
      ["engineEventQueue:moveToQueue", { instanceId: pending }],
    ]);
  });
});

describe("engineEventPaths", () => {
  test("lists registered instances by the route their events take", async () => {
    const t = newBackend();
    const onQueue = await insertInstance(t, { clientId: "a", eventsTargetSetAt: 5, name: "Queued" });
    const onWebhook = await insertInstance(t, { clientId: "b", name: "Legacy" });
    await insertInstance(t, { name: "Unregistered" });
    const result = await t.query(internal.ops.reads.engineEventPaths, { cursor: null });
    expect(result.page).toEqual([
      { instanceId: onQueue, name: "Queued", path: "queue", eventsTargetSetAt: 5 },
      { instanceId: onWebhook, name: "Legacy", path: "webhook", eventsTargetSetAt: null },
    ]);
  });
});
