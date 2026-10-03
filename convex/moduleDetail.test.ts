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
});
