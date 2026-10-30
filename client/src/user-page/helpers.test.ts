import { describe, expect, test } from "bun:test";
import { PAGE_ACCENTS, type PageAccent } from "@shared/user-pages";
import { countdownTickDelay } from "./clock";
import { slugFromPath } from "./slug";
import { accentStyle, hexChannels, readableOn } from "./theme";
import { displayHost, imageUrl, linkUrl } from "./urls";
import { runningEndsAt } from "./widgets/timer-widget";

describe("slugFromPath", () => {
  const cases: Array<{ path: string; slug: string | null }> = [
    { path: "/u/wolfy", slug: "wolfy" },
    { path: "/u/wolfy/", slug: "wolfy" },
    { path: "/u/caf%C3%A9", slug: "café" },
    { path: "/u/", slug: null },
    { path: "/u", slug: null },
    { path: "/u/wolfy/extra", slug: null },
    { path: "/u/%E0%A4%A", slug: null },
    { path: "/stream/wolfy", slug: null },
  ];
  for (const { path, slug } of cases) {
    test(`${path} names ${slug === null ? "no slug" : slug}`, () => {
      expect(slugFromPath(path, "/u/")).toBe(slug);
    });
  }
});

describe("countdownTickDelay", () => {
  const cases: Array<{ remaining: number; delay: number | null }> = [
    { remaining: 5000, delay: 1000 },
    { remaining: 4999, delay: 999 },
    { remaining: 4001, delay: 1 },
    { remaining: 250, delay: 250 },
    { remaining: 0, delay: null },
    { remaining: -30, delay: null },
  ];
  for (const { remaining, delay } of cases) {
    test(`${remaining}ms left ticks in ${delay}`, () => {
      const now = 1_700_000_000_000;
      expect(countdownTickDelay(now + remaining, now)).toBe(delay);
    });
  }
});

describe("runningEndsAt", () => {
  test("is the end of a running timer", () => {
    expect(runningEndsAt({ running: true, endsAt: 1234 })).toBe(1234);
  });

  test("is null for a paused, empty or malformed value", () => {
    expect(runningEndsAt({ running: false, remainingMs: 1000 })).toBeNull();
    expect(runningEndsAt(null)).toBeNull();
    expect(runningEndsAt({ running: true })).toBeNull();
    expect(runningEndsAt([1])).toBeNull();
  });
});

describe("accent theme", () => {
  test("hexChannels reads #rrggbb and refuses anything else", () => {
    expect(hexChannels("#8b5cf6")).toEqual([139, 92, 246]);
    expect(() => hexChannels("8b5cf6")).toThrow();
  });

  test("light accents take dark text and dark accents white", () => {
    expect(readableOn(hexChannels(PAGE_ACCENTS.amber.hex))).toEqual([23, 26, 43]);
    expect(readableOn(hexChannels(PAGE_ACCENTS.violet.hex))).toEqual([255, 255, 255]);
  });

  test("every preset gives both variables", () => {
    for (const accent of Object.keys(PAGE_ACCENTS) as PageAccent[]) {
      const style = accentStyle(accent) as Record<string, string>;
      expect(style["--accent"]).toMatch(/^\d+ \d+ \d+$/);
      expect(style["--on-accent"]).toMatch(/^\d+ \d+ \d+$/);
    }
  });
});

describe("page URLs", () => {
  test("links take http and https only", () => {
    expect(linkUrl("https://twitch.tv/wolfy")).toBe("https://twitch.tv/wolfy");
    expect(linkUrl("http://example.com")).toBe("http://example.com/");
    expect(linkUrl("javascript:alert(1)")).toBeNull();
    expect(linkUrl("data:text/html,hi")).toBeNull();
    expect(linkUrl("not a url")).toBeNull();
  });

  test("images take https only", () => {
    expect(imageUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(imageUrl("http://cdn.example.com/a.png")).toBeNull();
  });

  test("a host is shown without www", () => {
    expect(displayHost("https://www.youtube.com/@wolfy")).toBe("youtube.com");
    expect(displayHost("javascript:alert(1)")).toBe("");
  });
});
