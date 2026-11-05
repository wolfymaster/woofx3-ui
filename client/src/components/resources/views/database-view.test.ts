import { describe, expect, test } from "bun:test";
import type { DatabaseColumn } from "@woofx3/api/databases";
import { valuesOfDrafts } from "./database-view";

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
