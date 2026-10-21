import { describe, expect, test } from "bun:test";
import { hasEnginePending, withEnginePending, withoutEnginePending } from "./twitch-connect-return";

describe("withEnginePending", () => {
  const cases: Array<{ name: string; path: string; expected: string }> = [
    { name: "a bare path", path: "/admin/integrations", expected: "/admin/integrations?twitch_engine=pending" },
    {
      name: "a path with a query",
      path: "/admin/integrations?tab=a",
      expected: "/admin/integrations?tab=a&twitch_engine=pending",
    },
    {
      name: "a path with a hash",
      path: "/admin/integrations#x",
      expected: "/admin/integrations?twitch_engine=pending#x",
    },
  ];
  for (const { name, path, expected } of cases) {
    test(name, () => {
      expect(withEnginePending(path)).toBe(expected);
    });
  }
});

describe("hasEnginePending", () => {
  const cases: Array<{ name: string; search: string; expected: boolean }> = [
    { name: "marked", search: "?twitch_engine=pending", expected: true },
    { name: "marked among others", search: "?a=1&twitch_engine=pending", expected: true },
    { name: "another value", search: "?twitch_engine=ok", expected: false },
    { name: "empty", search: "", expected: false },
  ];
  for (const { name, search, expected } of cases) {
    test(name, () => {
      expect(hasEnginePending(search)).toBe(expected);
    });
  }
});

describe("withoutEnginePending", () => {
  test("drops only the marker", () => {
    expect(withoutEnginePending("?a=1&twitch_engine=pending")).toBe("?a=1");
  });
  test("leaves an empty query empty", () => {
    expect(withoutEnginePending("?twitch_engine=pending")).toBe("");
  });
});
