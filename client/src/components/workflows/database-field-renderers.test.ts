import { describe, expect, test } from "bun:test";
import type { DatabaseColumn } from "@woofx3/api/databases";
import { parseConfigFieldSource } from "@/lib/parse-config-fields";
import { pruneDatabaseValues } from "./database-field-renderers";

const games: DatabaseColumn[] = [
  { id: "game", label: "Game", type: "text", public: true },
  { id: "vod", label: "VOD", type: "url", public: true },
];

/** A step value referring to a form answer, written as the step editor writes it. */
const ANSWER = ["$", "{trigger.data.answers.game}"].join("");

describe("pruneDatabaseValues", () => {
  test("switching to another database drops the values of columns it lacks", () => {
    expect(pruneDatabaseValues({ game: ANSWER, mood: "chill" }, games)).toEqual({
      game: ANSWER,
    });
  });

  test("a database with no columns, or no value yet, holds nothing", () => {
    expect(pruneDatabaseValues({ game: "x" }, [])).toEqual({});
    expect(pruneDatabaseValues(undefined, games)).toEqual({});
    expect(pruneDatabaseValues("x", games)).toEqual({});
  });
});

describe("parseConfigFieldSource", () => {
  test("reads a databaseColumns source and drops one without its sibling", () => {
    expect(parseConfigFieldSource({ kind: "databaseColumns", databaseField: "target" })).toEqual({
      kind: "databaseColumns",
      databaseField: "target",
    });
    expect(parseConfigFieldSource({ kind: "databaseColumns" })).toBeUndefined();
  });
});
