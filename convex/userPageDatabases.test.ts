import { describe, expect, test } from "bun:test";
import type { DatabaseColumn } from "@woofx3/api/databases";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { PUBLIC_DATABASE_RECORDS } from "./userPageDatabases";

const GAMES = "woofx3:database:games";

const PUBLIC_GAME: DatabaseColumn = { id: "game", label: "Game", type: "text", public: true };
const PRIVATE_VIEWER: DatabaseColumn = { id: "viewer", label: "Viewer", type: "text", public: false };

async function fixture(columns: DatabaseColumn[]) {
  const t = newBackend();
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    const moduleId = await ctx.db.insert("moduleRepository", {
      instanceId,
      name: "woofx3",
      description: "",
      version: "0.45.0",
      tags: [],
    });
    const rowId = await ctx.db.insert("moduleResourceInstances", {
      instanceId,
      moduleId,
      engineInstanceId: "e-1",
      resourceInstanceId: "games",
      moduleName: "woofx3",
      kind: "database",
      displayName: "Games",
      canonicalId: GAMES,
      settings: { columns },
    });
    return { instanceId, rowId };
  });
  return { t, ...ids };
}

function change(
  instanceId: Id<"instances">,
  recordId: string,
  revision: number,
  publicValues: Record<string, string> | null,
  op: "created" | "updated" | "deleted" = "updated",
  createdAt = "2026-11-04T12:00:00Z"
) {
  return { instanceId, change: { databaseId: GAMES, recordId, op, revision, createdAt, publicValues } };
}

async function rows(t: ReturnType<typeof newBackend>) {
  return t.run(async (ctx) => ctx.db.query("userPageDatabaseRecords").collect());
}

describe("applyRecordChange", () => {
  test("keeps public columns only, and ignores an older revision", async () => {
    const { t, instanceId } = await fixture([PUBLIC_GAME, PRIVATE_VIEWER]);
    await t.mutation(
      internal.userPageDatabases.applyRecordChange,
      change(instanceId, "r1", 2, { game: "Hades", viewer: "leaked" })
    );
    await t.mutation(internal.userPageDatabases.applyRecordChange, change(instanceId, "r1", 1, { game: "Celeste" }));
    const stored = await rows(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.revision).toBe(2);
    expect(stored[0]?.values).toEqual([{ columnId: "game", value: "Hades" }]);
  });

  test("a delete removes the row, but not one newer than it", async () => {
    const { t, instanceId } = await fixture([PUBLIC_GAME]);
    await t.mutation(internal.userPageDatabases.applyRecordChange, change(instanceId, "r1", 3, { game: "Hades" }));
    await t.mutation(internal.userPageDatabases.applyRecordChange, change(instanceId, "r1", 2, null, "deleted"));
    expect(await rows(t)).toHaveLength(1);
    await t.mutation(internal.userPageDatabases.applyRecordChange, change(instanceId, "r1", 4, null, "deleted"));
    expect(await rows(t)).toHaveLength(0);
  });

  test("a database with no public column keeps nothing, and every change leaves a transient for the dashboard", async () => {
    const { t, instanceId } = await fixture([PRIVATE_VIEWER]);
    await t.mutation(internal.userPageDatabases.applyRecordChange, change(instanceId, "r1", 1, {}));
    expect(await rows(t)).toHaveLength(0);
    const transients = await t.run(async (ctx) => ctx.db.query("transientEvents").collect());
    expect(transients.map((row) => row.correlationKey)).toEqual([`database:${GAMES}`]);
  });

  test("trims a database to its newest rows", async () => {
    const { t, instanceId } = await fixture([PUBLIC_GAME]);
    await t.run(async (ctx) => {
      for (let i = 0; i < PUBLIC_DATABASE_RECORDS; i++) {
        await ctx.db.insert("userPageDatabaseRecords", {
          instanceId,
          databaseId: GAMES,
          recordId: `old-${i}`,
          values: [],
          createdAt: 1_000 + i,
          revision: 1,
          updatedAt: 0,
        });
      }
    });
    await t.mutation(
      internal.userPageDatabases.applyRecordChange,
      change(instanceId, "new", 1, { game: "Tunic" }, "created", "2026-11-04T12:00:00Z")
    );
    const stored = await rows(t);
    expect(stored).toHaveLength(PUBLIC_DATABASE_RECORDS);
    expect(stored.some((row) => row.recordId === "old-0")).toBe(false);
    expect(stored.some((row) => row.recordId === "new")).toBe(true);
  });
});

describe("cleanupDatabase", () => {
  test("strips a column that stopped being public, and empties a database left with none", async () => {
    const { t, instanceId, rowId } = await fixture([PUBLIC_GAME, { ...PRIVATE_VIEWER, public: true }]);
    await t.mutation(
      internal.userPageDatabases.applyRecordChange,
      change(instanceId, "r1", 1, { game: "Hades", viewer: "wolfy" })
    );

    await t.run(async (ctx) => ctx.db.patch(rowId, { settings: { columns: [PUBLIC_GAME, PRIVATE_VIEWER] } }));
    await t.mutation(internal.userPageDatabases.cleanupDatabase, { instanceId, databaseId: GAMES, cursor: null });
    expect((await rows(t))[0]?.values).toEqual([{ columnId: "game", value: "Hades" }]);

    await t.run(async (ctx) => ctx.db.delete(rowId));
    await t.mutation(internal.userPageDatabases.cleanupDatabase, { instanceId, databaseId: GAMES, cursor: null });
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("reconcile", () => {
  test("adds what the engine lists and drops what it no longer does", async () => {
    const { t, instanceId } = await fixture([PUBLIC_GAME]);
    await t.mutation(internal.userPageDatabases.applyRecordChange, change(instanceId, "gone", 1, { game: "Old" }));
    await t.mutation(internal.userPageDatabases.reconcilePage, {
      instanceId,
      databaseId: GAMES,
      records: [{ recordId: "r1", revision: 1, createdAt: 5, values: { game: "Celeste" } }],
    });
    await t.mutation(internal.userPageDatabases.finishReconcile, { instanceId, databaseId: GAMES, listed: ["r1"] });
    const stored = await rows(t);
    expect(stored.map((row) => row.recordId)).toEqual(["r1"]);
  });

  test("fills a column made public after the row was written, at the same revision", async () => {
    const PUBLIC_VIEWER = { ...PRIVATE_VIEWER, public: true };
    const { t, instanceId, rowId } = await fixture([PUBLIC_GAME, PRIVATE_VIEWER]);
    await t.mutation(internal.userPageDatabases.applyRecordChange, change(instanceId, "r1", 1, { game: "Hades" }));
    await t.run(async (ctx) => ctx.db.patch(rowId, { settings: { columns: [PUBLIC_GAME, PUBLIC_VIEWER] } }));
    await t.mutation(internal.userPageDatabases.reconcilePage, {
      instanceId,
      databaseId: GAMES,
      records: [{ recordId: "r1", revision: 1, createdAt: 5, values: { game: "Hades", viewer: "wolfy" } }],
    });
    expect((await rows(t))[0]?.values).toEqual([
      { columnId: "game", value: "Hades" },
      { columnId: "viewer", value: "wolfy" },
    ]);

    // A webhook redelivered at that revision carries the columns public back then.
    await t.mutation(internal.userPageDatabases.applyRecordChange, change(instanceId, "r1", 1, { game: "Hades" }));
    expect((await rows(t))[0]?.values).toHaveLength(2);
  });
});
