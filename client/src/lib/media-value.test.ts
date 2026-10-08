import { describe, expect, test } from "bun:test";
import {
  externalMediaValue,
  isExternalMediaValue,
  mediaKindFromUrl,
  mediaNameFromUrl,
  parseMediaUrl,
  toMediaValue,
} from "@/lib/media-value";

function url(input: string): URL {
  const parsed = parseMediaUrl(input);
  if (!parsed) {
    throw new Error(`expected ${input} to parse`);
  }
  return parsed;
}

describe("parseMediaUrl", () => {
  test("accepts absolute http and https URLs", () => {
    expect(parseMediaUrl("https://cdn.example.com/a.png")?.toString()).toBe("https://cdn.example.com/a.png");
    expect(parseMediaUrl("  http://example.com/x.mp3 ")?.toString()).toBe("http://example.com/x.mp3");
  });

  test("refuses other schemes, relative paths and blanks", () => {
    expect(parseMediaUrl("")).toBeNull();
    expect(parseMediaUrl("   ")).toBeNull();
    expect(parseMediaUrl("/assets/a.png")).toBeNull();
    expect(parseMediaUrl("example.com/a.png")).toBeNull();
    expect(parseMediaUrl("javascript:alert(1)")).toBeNull();
    expect(parseMediaUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(parseMediaUrl("ftp://example.com/a.png")).toBeNull();
  });
});

describe("mediaKindFromUrl", () => {
  test("reads the kind from the file extension, ignoring the query", () => {
    expect(mediaKindFromUrl(url("https://x.test/a/b.GIF?v=2"))).toBe("image");
    expect(mediaKindFromUrl(url("https://x.test/clip.webm"))).toBe("video");
    expect(mediaKindFromUrl(url("https://x.test/ding.mp3#t=1"))).toBe("audio");
  });

  test("is other when the path names no known file type", () => {
    expect(mediaKindFromUrl(url("https://x.test/"))).toBe("other");
    expect(mediaKindFromUrl(url("https://x.test/media/12345"))).toBe("other");
    expect(mediaKindFromUrl(url("https://x.test/doc.pdf"))).toBe("other");
  });
});

describe("mediaNameFromUrl", () => {
  test("uses the decoded file name, or the host when there is none", () => {
    expect(mediaNameFromUrl(url("https://x.test/sounds/big%20ding.mp3"))).toBe("big ding.mp3");
    expect(mediaNameFromUrl(url("https://x.test/"))).toBe("x.test");
  });
});

describe("externalMediaValue", () => {
  test("prefers the field's declared media type over the extension", () => {
    const value = externalMediaValue(url("https://x.test/stream"), "audio");
    expect(value).toEqual({ source: "url", name: "stream", url: "https://x.test/stream", type: "audio" });
    expect(isExternalMediaValue(value)).toBe(true);
  });
});

describe("toMediaValue", () => {
  test("keeps a library asset as it was stored", () => {
    const stored = { id: "res_1", name: "ding.mp3", url: "https://engine.test/r/res_1", type: "audio" };
    const value = toMediaValue(stored);
    expect(value).toEqual(stored);
    expect(value && isExternalMediaValue(value)).toBe(false);
  });

  test("reads an external value and a bare URL string as external", () => {
    expect(toMediaValue({ source: "url", name: "a.png", url: "https://x.test/a.png", type: "image" })).toEqual({
      source: "url",
      name: "a.png",
      url: "https://x.test/a.png",
      type: "image",
    });
    expect(toMediaValue("https://x.test/a.png")).toEqual({
      source: "url",
      name: "a.png",
      url: "https://x.test/a.png",
      type: "image",
    });
  });

  test("is null for values without a usable URL", () => {
    expect(toMediaValue(null)).toBeNull();
    expect(toMediaValue(undefined)).toBeNull();
    expect(toMediaValue("not a url")).toBeNull();
    expect(toMediaValue({ id: "res_1", name: "x" })).toBeNull();
  });
});
