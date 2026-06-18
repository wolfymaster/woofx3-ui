import { describe, expect, it } from "bun:test";
import { stableWidgetId, widgetCanonicalKey } from "./widgetKey";

describe("stableWidgetId", () => {
  it("returns the simple form unchanged", () => {
    expect(stableWidgetId("builtin:widget:media_alert")).toBe("builtin:widget:media_alert");
    expect(stableWidgetId("spotify:widget:now_playing")).toBe("spotify:widget:now_playing");
  });

  it("strips version and hash from a versioned canonical id", () => {
    expect(stableWidgetId("spotify:1.0.0:df18e02:widget:now_playing")).toBe(
      "spotify:widget:now_playing"
    );
  });

  it("returns undefined when the :widget: marker is absent", () => {
    expect(stableWidgetId("no-marker-here")).toBeUndefined();
  });

  it("returns undefined when the marker is at the start (empty module key)", () => {
    expect(stableWidgetId(":widget:foo")).toBeUndefined();
  });

  it("returns undefined when the manifestId is empty", () => {
    expect(stableWidgetId("mod:widget:")).toBeUndefined();
  });
});

describe("widgetCanonicalKey", () => {
  it("returns projectionKey normalised to stable form", () => {
    expect(widgetCanonicalKey({ projectionKey: "spotify:1.0.0:abc:widget:now_playing" })).toBe(
      "spotify:widget:now_playing"
    );
  });

  it("returns projectionKey as-is when already stable", () => {
    expect(widgetCanonicalKey({ projectionKey: "builtin:widget:media_alert" })).toBe(
      "builtin:widget:media_alert"
    );
  });

  it("constructs key from createdByRef + manifestId, stripping version from ref", () => {
    expect(
      widgetCanonicalKey({ createdByRef: "spotify:1.0.0:abc", manifestId: "now_playing" })
    ).toBe("spotify:widget:now_playing");
  });

  it("constructs key from simple createdByRef + manifestId", () => {
    expect(widgetCanonicalKey({ createdByRef: "builtin", manifestId: "media_alert" })).toBe(
      "builtin:widget:media_alert"
    );
  });

  it("normalises a versioned canonicalId fallback", () => {
    expect(
      widgetCanonicalKey({ canonicalId: "spotify:1.0.0:df18e02:widget:now_playing" })
    ).toBe("spotify:widget:now_playing");
  });

  it("passes through a stable canonicalId fallback unchanged", () => {
    expect(widgetCanonicalKey({ canonicalId: "spotify:widget:now_playing" })).toBe(
      "spotify:widget:now_playing"
    );
  });

  it("falls back to id when all other fields are missing", () => {
    expect(widgetCanonicalKey({ id: "raw-uuid" })).toBe("raw-uuid");
  });

  it("returns empty string when nothing is provided", () => {
    expect(widgetCanonicalKey({})).toBe("");
  });

  it("prefers projectionKey over createdByRef path", () => {
    expect(
      widgetCanonicalKey({
        projectionKey: "mod:widget:foo",
        createdByRef: "other",
        manifestId: "bar",
      })
    ).toBe("mod:widget:foo");
  });

  it("prefers createdByRef path over canonicalId", () => {
    expect(
      widgetCanonicalKey({
        createdByRef: "mod",
        manifestId: "foo",
        canonicalId: "mod:1.0.0:abc:widget:bar",
      })
    ).toBe("mod:widget:foo");
  });
});
