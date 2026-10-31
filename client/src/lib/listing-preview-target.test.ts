import { describe, expect, test } from "bun:test";
import type { CatalogListingDetail } from "@shared/marketplace-catalog";
import { galleryPreviews, livePreviewTarget, previewAvailable } from "./listing-preview-target";

function listing(overrides: Partial<CatalogListingDetail> = {}): CatalogListingDetail {
  return {
    id: "counter",
    type: "module",
    name: "Counter",
    description: "",
    version: "1.0.0",
    author: "wolfy",
    category: "Utilities",
    tags: [],
    images: {},
    tier: "public",
    credits: [],
    previews: [],
    ...overrides,
  };
}

const emptyModule: NonNullable<CatalogListingDetail["module"]> = {
  triggers: [],
  actions: [],
  functions: [],
  widgets: [],
  themeable: [],
  themes: [],
  requires: {},
};

describe("livePreviewTarget", () => {
  test("an author-declared live entry wins over anything derived", () => {
    const declared = { kind: "live" as const, url: "custom:target", caption: "see it here" };
    const target = livePreviewTarget(
      listing({
        previews: [declared],
        module: { ...emptyModule, widgets: [{ id: "timer", name: "Timer", description: "" }] },
      })
    );
    // The author knows their own module better than a derivation does.
    expect(target).toEqual(declared);
  });

  test("a module's first widget becomes its live preview", () => {
    const target = livePreviewTarget(
      listing({
        module: {
          ...emptyModule,
          widgets: [
            { id: "timer", name: "Timer", description: "" },
            { id: "other", name: "Other", description: "" },
          ],
        },
      })
    );
    expect(target?.url).toBe("counter:widget:timer");
    expect(target?.caption).toContain("Timer");
  });

  test("a theme previews the widget it reskins, not itself", () => {
    // A theme has no widgets of its own, so without this it would be the one
    // type with nothing to preview.
    const target = livePreviewTarget(
      listing({
        id: "timer-neon",
        type: "theme",
        baseModuleId: "woofx3",
        module: {
          ...emptyModule,
          themes: [{ id: "neon", name: "Neon", target: "woofx3:widget:timer" }],
        },
      })
    );
    expect(target?.url).toBe("woofx3:widget:timer");
    expect(target?.caption).toContain("timer");
    expect(target?.caption).toContain("woofx3");
  });

  test("a theme that declares no target has no live preview to offer", () => {
    expect(livePreviewTarget(listing({ type: "theme", module: emptyModule }))).toBeNull();
  });

  test("a module with no widgets has no live preview", () => {
    expect(livePreviewTarget(listing({ module: emptyModule }))).toBeNull();
    expect(livePreviewTarget(listing())).toBeNull();
  });
});

describe("galleryPreviews", () => {
  test("keeps the files and leaves the live entry to the live path", () => {
    const gallery = galleryPreviews(
      listing({
        previews: [
          { kind: "image", url: "a.webp" },
          { kind: "live", url: "x:widget:y" },
          { kind: "video", url: "b.mp4" },
        ],
      })
    );
    expect(gallery.map((preview) => preview.kind)).toEqual(["image", "video"]);
  });
});

describe("previewAvailable", () => {
  test("is false when there is nothing honest to show", () => {
    // A dead Preview button on half the catalog is worse than none.
    expect(previewAvailable(listing())).toBe(false);
    expect(previewAvailable(listing({ type: "emote", emotes: [] }))).toBe(false);
  });

  test("is true for a gallery, a live target, or a theme's base widget", () => {
    expect(previewAvailable(listing({ previews: [{ kind: "image", url: "a.webp" }] }))).toBe(true);
    expect(
      previewAvailable(
        listing({ module: { ...emptyModule, widgets: [{ id: "timer", name: "Timer", description: "" }] } })
      )
    ).toBe(true);
    expect(
      previewAvailable(
        listing({
          type: "theme",
          module: { ...emptyModule, themes: [{ id: "neon", name: "Neon", target: "woofx3:widget:timer" }] },
        })
      )
    ).toBe(true);
  });
});
