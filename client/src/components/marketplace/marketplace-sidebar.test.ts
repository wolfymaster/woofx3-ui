import { describe, expect, test } from "bun:test";
import type { CatalogListing } from "@convex/lib/marketplaceCatalog";
import { countByType, moduleCategories } from "./marketplace-sidebar";

function listing(id: string, type: CatalogListing["type"], category: string): CatalogListing {
  return {
    id,
    type,
    name: id,
    description: "",
    version: "1.0.0",
    author: "wolfy",
    category,
    tags: [],
    images: {},
    tier: "public",
    credits: [],
  };
}

describe("countByType", () => {
  test("counts every type, including the ones with nothing in them", () => {
    const counts = countByType([
      listing("a", "module", "Utilities"),
      listing("b", "module", "Audio"),
      listing("c", "emote", "Emotes"),
    ]);
    // A zero still has to be present, or the rail renders `undefined`.
    expect(counts).toEqual({ module: 2, theme: 0, emote: 1, overlay: 0, alert: 0 });
  });

  test("an empty catalog counts zero everywhere", () => {
    expect(countByType([])).toEqual({ module: 0, theme: 0, emote: 0, overlay: 0, alert: 0 });
  });
});

describe("moduleCategories", () => {
  test("counts module categories and sorts them by name", () => {
    const categories = moduleCategories([
      listing("a", "module", "Utilities"),
      listing("b", "module", "Audio"),
      listing("c", "module", "Utilities"),
    ]);
    expect(categories.map((entry) => [entry.label, entry.count])).toEqual([
      ["Audio", 1],
      ["Utilities", 2],
    ]);
  });

  test("leaves the non-module types out, so an emote pack is not counted twice", () => {
    // They already appear as types in the rail above the categories.
    const categories = moduleCategories([
      listing("a", "emote", "Emotes"),
      listing("b", "overlay", "Overlays"),
      listing("c", "alert", "Alerts"),
      listing("d", "theme", "Themes"),
    ]);
    expect(categories).toEqual([]);
  });

  test("gives each category a colour so the swatch is stable across sessions", () => {
    const [first] = moduleCategories([listing("a", "module", "Utilities")]);
    const [again] = moduleCategories([listing("b", "module", "Utilities")]);
    expect(first.color).toBe(again.color);
    expect(first.color).toContain("oklch");
  });
});
