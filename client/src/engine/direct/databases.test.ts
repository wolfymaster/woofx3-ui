import { describe, expect, test } from "bun:test";
import { directKeys as k } from "./keys";

describe("database keys", () => {
  test("every read of a database sits under its root, so one invalidation reaches them all", () => {
    const root = k.databases.database("woofx3:database:games");
    for (const key of [
      k.databases.records("woofx3:database:games", { limit: 50 }),
      k.databases.record("woofx3:database:games", "row-1"),
    ]) {
      expect(key.slice(0, root.length)).toEqual([...root]);
    }
    expect(k.databases.records("woofx3:database:other", { limit: 50 }).slice(0, root.length)).not.toEqual([...root]);
  });
});
