import { describe, expect, test } from "bun:test";
import type { DatabaseColumn, DatabaseRecord } from "@woofx3/api/databases";
import { draftsOf, valuesOfDrafts } from "./database-view";

const columns: DatabaseColumn[] = [
  { id: "game", label: "Game", type: "text", public: true },
  { id: "score", label: "Score", type: "number", public: false },
  { id: "vod", label: "VOD", type: "url", public: true },
];

describe("valuesOfDrafts", () => {
  test("sends each cell in its column's type and empties a blank one", () => {
    expect(valuesOfDrafts(columns, { game: "Celeste", score: "12", vod: "" })).toEqual({
      ok: true,
      values: { game: "Celeste", score: 12, vod: null },
    });
  });

  test("names every cell that does not fit, by column", () => {
    const result = valuesOfDrafts(columns, { game: "Celeste", score: "lots", vod: "not a link" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["score", "vod"]);
    }
  });
});

describe("draftsOf", () => {
  const vip: DatabaseColumn = { id: "vip", label: "VIP", type: "boolean", public: false };
  const record = (values: DatabaseRecord["values"]): DatabaseRecord => ({
    id: "r1",
    databaseId: "woofx3:database:giveaway",
    revision: 1,
    createdAt: "2026-11-05T00:00:00Z",
    updatedAt: "2026-11-05T00:00:00Z",
    values,
  });

  test("starts an empty yes/no cell as no, so the switch saves what it shows", () => {
    const drafts = draftsOf([vip, ...columns], null);
    expect(drafts).toEqual({ vip: "false", game: "", score: "", vod: "" });
    expect(valuesOfDrafts([vip], drafts)).toEqual({ ok: true, values: { vip: false } });
  });

  test("keeps a stored yes", () => {
    const drafts = draftsOf([vip], record({ vip: true }));
    expect(valuesOfDrafts([vip], drafts)).toEqual({ ok: true, values: { vip: true } });
  });
});
