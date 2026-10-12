import { describe, expect, test } from "bun:test";
import { alertLengthSeconds, durationOf, fileName, formatSeconds, layerLabel, longestLayerId } from "./alert-editor";

function layer(id: string, duration?: unknown) {
  return { id, settings: duration === undefined ? {} : { duration } };
}

describe("alert length", () => {
  test("is the longest layer's duration", () => {
    const layers = [layer("a", 5), layer("b", 8)];
    expect(alertLengthSeconds(layers)).toBe(8);
    expect(longestLayerId(layers)).toBe("b");
  });

  test("names no longest layer on a tie", () => {
    expect(longestLayerId([layer("a", 5), layer("b", 5)])).toBeUndefined();
  });

  test("is zero, with no longest layer, when no layer has a length", () => {
    const layers = [layer("a"), layer("b", 0)];
    expect(alertLengthSeconds(layers)).toBe(0);
    expect(longestLayerId(layers)).toBeUndefined();
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
