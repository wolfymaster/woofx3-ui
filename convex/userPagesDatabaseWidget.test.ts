import { describe, expect, test } from "bun:test";
import { defaultPageContent, type PageContent, type PublicPageLookup } from "@shared/user-pages";
import type { DatabaseColumn } from "@woofx3/api/databases";
import { api, internal } from "./_generated/api";
import { compareCells } from "./lib/publicPage";
import { type Fixture, fixture } from "./lib/userPages.fixtures";

const GAMES = "woofx3:database:games";
const OTHER = "woofx3:database:other";

const COLUMNS: DatabaseColumn[] = [
  { id: "game", label: "Game", type: "text", public: true },
  { id: "hours", label: "Hours", type: "number", public: true },
  { id: "viewer", label: "Viewer", type: "text", public: false },
];

async function withDatabases(): Promise<Fixture> {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const module = await ctx.db.query("moduleRepository").first();
    if (!module) {
      throw new Error("fixture has no module");
    }
    for (const [canonicalId, id] of [
      [GAMES, "games"],
      [OTHER, "other"],
    ]) {
      await ctx.db.insert("moduleResourceInstances", {
        instanceId: f.instanceId,
        moduleId: module._id,
        engineInstanceId: `uuid-${id}`,
        resourceInstanceId: id,
        moduleName: "woofx3",
        kind: "database",
        displayName: id,
        canonicalId,
        settings: { columns: COLUMNS },
      });
    }
  });
  const rows: [string, string, number, string][] = [
    ["r1", "Celeste", 9, "a"],
    ["r2", "Hades", 30, "b"],
    ["r3", "Tunic", 4, "c"],
  ];
  for (const [databaseId, prefix] of [
    [GAMES, ""],
    [OTHER, "other-"],
  ]) {
    for (const [index, [recordId, game, hours, viewer]] of rows.entries()) {
      await f.t.mutation(internal.userPageDatabases.applyRecordChange, {
        instanceId: f.instanceId,
        change: {
          databaseId,
          recordId: `${prefix}${recordId}`,
          op: "created",
          revision: 1,
          createdAt: new Date(Date.UTC(2026, 10, 1 + index)).toISOString(),
          // The engine never sends a private column; one arriving anyway must not be stored.
          publicValues: { game, hours, viewer } as Record<string, string | number>,
        },
      });
    }
  }
  return f;
}

function databaseWidget(config: { sortBy?: string; direction?: "asc" | "desc"; columns?: string[] } = {}) {
  return {
    id: "played",
    type: "database" as const,
    config: {
      resource: GAMES,
      columns: config.columns ?? ["game", "hours", "viewer"],
      sortBy: config.sortBy ?? "createdAt",
      direction: config.direction ?? "desc",
      limit: 10,
    },
  };
}

function page(widget: ReturnType<typeof databaseWidget>): PageContent {
  return {
    ...defaultPageContent(),
    sections: [{ id: "games", region: "main", visibility: { kind: "public" }, widgets: [widget] }],
  };
}

async function publish(f: Fixture, content: PageContent): Promise<void> {
  const before = await f.owner.query(api.userPages.forEditing, { instanceId: f.instanceId });
  const { revision } = await f.owner.mutation(api.userPages.saveDraft, {
    instanceId: f.instanceId,
    baseRevision: before?.draft.revision ?? 0,
    content,
  });
  await f.owner.mutation(api.userPages.publish, { instanceId: f.instanceId, revision });
}

async function shownDatabase(f: Fixture) {
  const result: PublicPageLookup = await f.t.query(api.userPagesPublic.bySlug, { slug: "wolfy" });
  if (result.kind !== "page") {
    throw new Error(`expected a page, got ${result.kind}`);
  }
  const section = result.sections[0];
  const widget = section?.kind === "open" ? section.widgets[0] : undefined;
  if (widget?.type !== "database") {
    throw new Error("expected a database widget");
  }
  return { widget, result };
}

describe("the public database widget", () => {
  test("shows only columns that are public now, newest first by default", async () => {
    const f = await withDatabases();
    await publish(f, page(databaseWidget()));
    const { widget, result } = await shownDatabase(f);
    expect(widget.columns.map((column) => column.id)).toEqual(["game", "hours"]);
    expect(widget.rows).toEqual([
      ["Tunic", 4],
      ["Hades", 30],
      ["Celeste", 9],
    ]);
    expect(JSON.stringify(result)).not.toContain('"viewer"');
    expect(JSON.stringify(result)).not.toContain("other-");
  });

  test("drops a column made private before the projection is cleaned", async () => {
    const f = await withDatabases();
    await publish(f, page(databaseWidget()));
    // The streamer turns "Hours" private; the instance webhook brings the new settings.
    await f.t.mutation(internal.moduleResourceInstances.upsertFromWebhook, {
      instanceId: f.instanceId,
      instance: {
        id: "uuid-games",
        moduleId: "m",
        moduleName: "woofx3",
        moduleKey: "woofx3:0.45.0:abc",
        kind: "database",
        instanceId: "games",
        displayName: "games",
        canonicalId: GAMES,
        settings: { columns: COLUMNS.map((column) => (column.id === "hours" ? { ...column, public: false } : column)) },
      },
    });
    const { widget, result } = await shownDatabase(f);
    expect(widget.columns.map((column) => column.id)).toEqual(["game"]);
    expect(JSON.stringify(result)).not.toContain('"Hours"');
  });

  test("sorts by a number column by value", async () => {
    const f = await withDatabases();
    await publish(f, page(databaseWidget({ sortBy: "hours", direction: "asc" })));
    const { widget } = await shownDatabase(f);
    expect(widget.rows.map((row) => row[1])).toEqual([4, 9, 30]);
  });

  test("serves nothing for a database the published page does not bind", async () => {
    const f = await withDatabases();
    await publish(f, page(databaseWidget()));
    const rows = await f.t.run(async (ctx) =>
      ctx.db
        .query("userPageState")
        .withIndex("by_instance_canonical", (q) => q.eq("instanceId", f.instanceId).eq("canonicalId", OTHER))
        .collect()
    );
    expect(rows).toEqual([]);
  });
});

describe("compareCells", () => {
  test.each<[string | number | boolean | null, string | number | boolean | null, number]>([
    [2, 10, -1],
    ["b", "a", 1],
    ["2026-01-02", "2025-12-31", 1],
    [false, true, -1],
    [null, "a", 1],
    ["a", null, -1],
  ])("%p vs %p", (a, b, sign) => {
    expect(Math.sign(compareCells(a, b))).toBe(sign);
  });
});
