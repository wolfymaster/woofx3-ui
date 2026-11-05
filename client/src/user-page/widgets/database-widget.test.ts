import { describe, expect, test } from "bun:test";
import type { PublicDatabaseColumn } from "@shared/user-pages";
import { cellLabel } from "./database-widget";

const column = (
  type: PublicDatabaseColumn["type"],
  extra: Partial<PublicDatabaseColumn> = {}
): PublicDatabaseColumn => ({
  id: "c",
  label: "C",
  type,
  ...extra,
});

describe("cellLabel", () => {
  test("shows a select's option label, a yes or no, and nothing for an empty cell", () => {
    expect(cellLabel(column("select", { options: [{ value: "chill", label: "Chill" }] }), "chill")).toBe("Chill");
    expect(cellLabel(column("boolean"), true)).toBe("Yes");
    expect(cellLabel(column("text"), null)).toBe("");
    expect(cellLabel(column("number"), 12)).toBe("12");
  });

  test("shows a date in the visitor's style, on the day it names", () => {
    expect(cellLabel(column("date"), "2026-11-04")).toContain("2026");
    expect(cellLabel(column("date"), "not a date")).toBe("not a date");
  });
});
