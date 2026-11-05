import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { TRANSIENT_SWEEP_BATCH } from "./lib/engineEvents/config";

type Backend = ReturnType<typeof newBackend>;

async function seed(t: Backend, expiresAt: number[]): Promise<Id<"instances">> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    for (const [index, at] of expiresAt.entries()) {
      await ctx.db.insert("transientEvents", {
        instanceId,
        correlationKey: `key-${index}`,
        type: "test",
        status: "success",
        expiresAt: at,
      });
    }
    return instanceId;
  });
}

async function remaining(t: Backend): Promise<number> {
  return t.run(async (ctx) => (await ctx.db.query("transientEvents").collect()).length);
}

describe("sweepExpired", () => {
  test("deletes expired rows and keeps live ones", async () => {
    const t = newBackend();
    const now = Date.now();
    await seed(t, [now - 1000, now - 1, now + 60_000]);
    await t.mutation(internal.transientEvents.sweepExpired, {});
    expect(await remaining(t)).toBe(1);
  });

  test("a full batch sweeps again until the backlog is gone", async () => {
    const t = newBackend();
    const past = Date.now() - 1000;
    await seed(
      t,
      Array.from({ length: TRANSIENT_SWEEP_BATCH + 3 }, () => past)
    );
    await t.mutation(internal.transientEvents.sweepExpired, {});
    expect(await remaining(t)).toBe(3);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => job.name)).toEqual(["transientEvents:sweepExpired"]);
    await t.mutation(internal.transientEvents.sweepExpired, {});
    expect(await remaining(t)).toBe(0);
  });

  test("emit schedules no per-row delete", async () => {
    const t = newBackend();
    const instanceId = await seed(t, []);
    await t.mutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey: "k",
      type: "test",
      status: "success",
    });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toEqual([]);
  });
});
