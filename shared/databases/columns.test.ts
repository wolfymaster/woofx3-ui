import { describe, expect, test } from "bun:test";
import type { DatabaseColumn } from "@woofx3/api/databases";
import { columnIdFor, databaseColumnProblems, GAMES_PLAYED_COLUMNS, parseCell, parseDatabaseColumns } from "./columns";

const text = (id: string, label = "Game"): DatabaseColumn => ({ id, label, type: "text", public: false });
const choice = (options: { value: string; label: string }[]): DatabaseColumn => ({
  id: "mood",
  label: "Mood",
  type: "select",
  public: false,
  options,
});

describe("databaseColumnProblems", () => {
  test.each<[string, DatabaseColumn[], string | null]>([
    ["a valid set", [text("game"), choice([{ value: "chill", label: "Chill" }])], null],
    ["the games template", [...GAMES_PLAYED_COLUMNS], null],
    ["a blank name", [text("game", " ")], "columns[0].label"],
    ["a long name", [text("game", "x".repeat(101))], "columns[0].label"],
    ["an id of digits", [text("123")], "columns[0].id"],
    ["an id with a space", [text("a b")], "columns[0].id"],
    ["a repeated id", [text("game"), text("game", "Other")], "columns[1].id"],
    ["a choice with no options", [choice([])], "columns[0].options"],
    [
      "a repeated option",
      [
        choice([
          { value: "a", label: "A" },
          { value: "a", label: "B" },
        ]),
      ],
      "columns[0].options[1].value",
    ],
    ["too many columns", Array.from({ length: 33 }, (_, i) => text(`c${i}`)), "columns"],
  ])("%s", (_, columns, path) => {
    const problems = databaseColumnProblems(columns, "columns");
    if (path === null) {
      expect(problems).toEqual([]);
    } else {
      expect(problems.map((problem) => problem.path)).toContain(path);
    }
  });
});

describe("parseDatabaseColumns", () => {
  test("keeps valid entries, defaults public to false and drops the rest", () => {
    const columns = parseDatabaseColumns({
      columns: [{ id: "game", label: "Game", type: "text" }, { id: "x", type: "color" }, "nope"],
    });
    expect(columns).toEqual([{ id: "game", label: "Game", type: "text", public: false }]);
    expect(parseDatabaseColumns({})).toEqual([]);
  });
});

describe("columnIdFor", () => {
  test("makes an id from the name, unique and never all digits", () => {
    expect(columnIdFor("First played", new Set())).toBe("first_played");
    expect(columnIdFor("Game", new Set(["game"]))).toBe("game_2");
    expect(columnIdFor("2024", new Set())).toBe("c_2024");
    expect(columnIdFor("!!!", new Set())).toBe("column");
  });
});

describe("parseCell", () => {
  const columns: Record<string, DatabaseColumn> = {
    text: text("t"),
    number: { id: "n", label: "N", type: "number", public: false },
    boolean: { id: "b", label: "B", type: "boolean", public: false },
    date: { id: "d", label: "D", type: "date", public: false },
    url: { id: "u", label: "U", type: "url", public: false },
    select: choice([{ value: "chill", label: "Chill" }]),
  };
  test.each<[string, string, unknown]>([
    ["text", "Celeste", "Celeste"],
    ["number", " 12.5 ", 12.5],
    ["boolean", "true", true],
    ["date", "2026-11-04", "2026-11-04"],
    ["url", "https://example.com", "https://example.com"],
    ["select", "chill", "chill"],
    ["number", "", null],
  ])("%s %p", (type, input, value) => {
    expect(parseCell(columns[type], input)).toEqual({ ok: true, value } as never);
  });
  test.each<[string, string, string]>([
    ["number", "twelve", "Enter a number"],
    ["boolean", "yes", "Choose yes or no"],
    ["date", "yesterday", "Enter a date"],
    ["url", "ftp://example.com", "Enter a link starting with http:// or https://"],
    ["select", "hype", "Pick one of the options"],
  ])("refuses %s %p", (type, input, error) => {
    expect(parseCell(columns[type], input)).toEqual({ ok: false, error });
  });
});
