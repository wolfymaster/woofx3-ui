import { describe, expect, test } from "bun:test";
import { parseManifestSettings } from "./moduleDetail";

describe("parseManifestSettings", () => {
  test("keeps the kind a resource_ref setting links, so the settings pane can offer a picker", () => {
    const settings = parseManifestSettings({
      settings: [
        { id: "timer", label: "Subathon timer", type: "resource_ref", resourceKind: "timer" },
        { id: "symbol", label: "Currency symbol", type: "text" },
      ],
    });
    expect(settings[0]).toMatchObject({ id: "timer", type: "resource_ref", resourceKind: "timer" });
    expect(settings[1]).not.toHaveProperty("resourceKind");
  });

  test("keeps a list setting's row fields, so the settings pane can render its rows", () => {
    const settings = parseManifestSettings({
      settings: [
        {
          id: "items",
          label: "Entries",
          type: "list",
          itemFields: [{ id: "label", label: "Entry", type: "text", required: true }],
        },
      ],
    });
    expect(settings[0]).toMatchObject({
      id: "items",
      type: "list",
      itemFields: [{ id: "label", label: "Entry", type: "text", required: true }],
    });
  });

  test("leaves out a list setting whose rows hold nothing it can render", () => {
    const settings = parseManifestSettings({
      settings: [
        { id: "empty", label: "Empty", type: "list" },
        { id: "nested", label: "Nested", type: "list", itemFields: [{ id: "x", label: "X", type: "list" }] },
        { id: "symbol", label: "Currency symbol", type: "text" },
      ],
    });
    expect(settings.map((s) => s.id)).toEqual(["symbol"]);
  });
});
