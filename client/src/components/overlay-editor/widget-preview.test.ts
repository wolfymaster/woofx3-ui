import { describe, expect, test } from "bun:test";
import { widgetPreviewFor } from "./widget-preview";

describe("widgetPreviewFor", () => {
  test("samples content the way each widget actually draws it", () => {
    expect(widgetPreviewFor({ name: "Text", taxonomy: ["text"] })).toEqual({
      kind: "glyph",
      sample: "Aa",
      live: false,
    });
    expect(widgetPreviewFor({ name: "Database value", taxonomy: ["data.database"] })).toEqual({
      kind: "data",
      sample: "{value}",
      live: true,
    });
    expect(widgetPreviewFor({ name: "Counter", taxonomy: ["data.counter"] }).sample).toBe("1,024");
    expect(widgetPreviewFor({ name: "Timer", taxonomy: ["data.timer"] }).sample).toBe("00:42");
    expect(widgetPreviewFor({ name: "Queue", taxonomy: ["data.queue"] }).sample).toBe("1 → 2");
  });

  test("marks only source-bound content as live", () => {
    expect(widgetPreviewFor({ name: "Counter", taxonomy: ["data.counter"] }).live).toBe(true);
    expect(widgetPreviewFor({ name: "Text", taxonomy: ["text"] }).live).toBe(false);
  });

  test("shows media as a swatch rather than pretending it draws text", () => {
    expect(widgetPreviewFor({ name: "Image", taxonomy: ["media.image"] }).kind).toBe("swatch");
    expect(widgetPreviewFor({ name: "Lottie", taxonomy: ["media.animation"] }).kind).toBe("swatch");
  });

  test("uses a wordmark of the widget's own name for overlays and unknown families", () => {
    expect(widgetPreviewFor({ name: "Hype Board", taxonomy: ["overlay.hype"] })).toEqual({
      kind: "wordmark",
      sample: "HYPE BOARD",
      live: false,
    });
    expect(widgetPreviewFor({ name: "Wheel Spin", taxonomy: ["overlay.wheel"] }).sample).toBe("WHEEL SPIN");
    expect(widgetPreviewFor({ name: "Unknown thing", taxonomy: ["custom.thing"] }).sample).toBe("UNKNOWN THING");
    expect(widgetPreviewFor({ name: "Legacy" }).sample).toBe("LEGACY");
  });

  test("takes the first declared taxonomy that is known, ignoring blank entries", () => {
    expect(widgetPreviewFor({ name: "Mixed", taxonomy: ["  ", "media.video", "data.timer"] }).kind).toBe("swatch");
    expect(widgetPreviewFor({ name: "Mixed", taxonomy: ["  ", "data.timer", "media.video"] }).sample).toBe("00:42");
  });

  test("falls back within a known family when the specific axis is new", () => {
    expect(widgetPreviewFor({ name: "New source", taxonomy: ["data.remote"] })).toEqual({
      kind: "data",
      sample: "{value}",
      live: true,
    });
    expect(widgetPreviewFor({ name: "Rich text", taxonomy: ["text.rich"] }).sample).toBe("Aa");
  });
});
