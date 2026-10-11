import { describe, expect, test } from "bun:test";
import { mediaLengthEstimates, PROFILES, resolveTimeline } from "@woofx3/scene/model";
import {
  alertLengthSeconds,
  durationOf,
  fileName,
  formatSeconds,
  layerLabel,
  playedLengthSeconds,
} from "./alert-editor";

function layer(id: string, duration?: unknown) {
  return { id, settings: duration === undefined ? {} : { duration } };
}

describe("alert length", () => {
  test("is the longest layer's duration", () => {
    const layers = [layer("a", 5), layer("b", 8)];
    expect(alertLengthSeconds(layers)).toBe(8);
  });

  test("is zero when no layer has a length", () => {
    expect(alertLengthSeconds([layer("a"), layer("b", 0)])).toBe(0);
  });

  test("reads a missing, negative or non-number duration as none", () => {
    expect(durationOf(layer("a"))).toBe(0);
    expect(durationOf(layer("a", -2))).toBe(0);
    expect(durationOf(layer("a", "5"))).toBe(0);
    expect(durationOf(layer("a", 2.5))).toBe(2.5);
  });
});

describe("formatSeconds", () => {
  test("shows whole seconds bare and anything else to a tenth", () => {
    expect(formatSeconds(5)).toBe("5s");
    expect(formatSeconds(2.5)).toBe("2.5s");
    expect(formatSeconds(1.25)).toBe("1.3s");
  });
});

describe("layerLabel", () => {
  const shown = (text: string) => text.replace("{user}", "user");

  test("names a Text layer by its text as the page shows it", () => {
    expect(layerLabel({ kind: "text", name: "Text", settings: { text: " {user} followed " } }, shown)).toBe(
      "user followed"
    );
  });

  test("falls back to the name for a Text layer with no text", () => {
    expect(layerLabel({ kind: "text", name: "Text", settings: { text: "  " } }, shown)).toBe("Text");
  });

  test("adds a media layer's file to its name", () => {
    expect(layerLabel({ kind: "image", name: "Image", settings: { src: { name: "cat.png" } } }, shown)).toBe(
      "Image · cat.png"
    );
    expect(layerLabel({ kind: "video", name: "Video", settings: { src: "https://x.test/a/clip.webm" } }, shown)).toBe(
      "Video · clip.webm"
    );
    expect(layerLabel({ kind: "other", name: "Confetti", settings: {} }, shown)).toBe("Confetti");
  });
});

describe("fileName", () => {
  test("reads an asset's name, a URL's last segment, or nothing", () => {
    expect(fileName({ name: "a.png", url: "https://x.test/b.png" })).toBe("a.png");
    expect(fileName("https://x.test/b.png")).toBe("b.png");
    expect(fileName(undefined)).toBe("");
  });
});

describe("playedLengthSeconds", () => {
  const placement = (settings: Record<string, unknown>) => ({
    widget: "woofx3:widget:text",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    z: "a0",
    settings,
    name: "Text",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
  });
  const tracksOf = (doc: Parameters<typeof resolveTimeline>[0]) =>
    resolveTimeline(doc, PROFILES.alert, { startedAtMs: 0 }, { estimate: { durationsMs: mediaLengthEstimates(doc) } });

  test("counts a layer's exit transition, as the overlay plays it", () => {
    const doc = {
      layout: { width: 1920, height: 1080 },
      widgets: { text: placement({ duration: 5 }) },
      behaviors: {
        out: {
          type: "transition",
          kind: "fade",
          target: "text",
          order: "a0",
          timing: { anchor: "exit" as const, offsetMs: 0, durationMs: 400, easing: "ease-out" },
          params: { phase: "out" },
        },
      },
    };
    expect(playedLengthSeconds(tracksOf(doc), [{ settings: { duration: 5 } }])).toBe(5.4);
  });

  test("an alert with nothing timed holds as long as the overlay holds it", () => {
    const doc = { layout: { width: 1920, height: 1080 }, widgets: {}, behaviors: {} };
    expect(playedLengthSeconds(tracksOf(doc), [])).toBe(5);
  });

  test("falls back to the longest layer without tracks", () => {
    expect(playedLengthSeconds(null, [layer("a", 3), layer("b", 7)])).toBe(7);
  });
});
