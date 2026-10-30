import { describe, expect, test } from "bun:test";
import { parseViewerFacts } from "./viewer-facts";

describe("parseViewerFacts", () => {
  test("keeps well-formed entries in the engine's order", () => {
    expect(
      parseViewerFacts([
        { path: "id", name: "Viewer ID", description: "The id.", valueKind: "string" },
        {
          path: "user.messages",
          name: "Messages",
          description: "",
          valueKind: "number",
          window: "lifetime",
        },
      ])
    ).toEqual([
      { path: "id", name: "Viewer ID", description: "The id.", valueKind: "string" },
      { path: "user.messages", name: "Messages", description: "", valueKind: "number", window: "lifetime" },
    ]);
  });

  test("drops an entry with a bad path or an unknown kind", () => {
    expect(
      parseViewerFacts([
        { path: "user messages", name: "A", valueKind: "number" },
        { path: "user.messages", name: "B", valueKind: "duration" },
        { path: "", name: "C", valueKind: "string" },
        null,
      ])
    ).toEqual([]);
  });

  test("names an entry by its path when it has no name, and drops an unknown window", () => {
    expect(parseViewerFacts([{ path: "user.streak", valueKind: "number", window: "forever" }])).toEqual([
      { path: "user.streak", name: "user.streak", description: "", valueKind: "number" },
    ]);
  });

  test("rejects an answer that is not a list", () => {
    expect(() => parseViewerFacts({ facts: [] })).toThrow();
  });
});
