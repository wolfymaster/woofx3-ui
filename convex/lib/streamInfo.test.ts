import { describe, expect, test } from "bun:test";
import {
  addTagProblem,
  categoriesFromHelix,
  changedFields,
  channelInfoFromHelix,
  characterCount,
  diffStreamInfo,
  isEmptyPatch,
  lengthCounter,
  MAX_TAGS,
  markerDescriptionProblem,
  type StreamInfo,
  sizedBoxArtUrl,
  tagProblem,
  tagsProblem,
  titleCounter,
  titleProblem,
} from "./streamInfo";

const JUST_CHATTING = { id: "509658", name: "Just Chatting" };
const VALORANT = { id: "516575", name: "VALORANT" };

function info(overrides: Partial<StreamInfo> = {}): StreamInfo {
  return { title: "Chill stream", category: JUST_CHATTING, tags: ["English", "Chill"], ...overrides };
}

describe("tagProblem", () => {
  test("accepts letters and digits", () => {
    expect(tagProblem("Speedrun")).toBeNull();
    expect(tagProblem("GTA5")).toBeNull();
  });

  test("accepts letters from other scripts", () => {
    expect(tagProblem("日本語")).toBeNull();
    expect(tagProblem("Español")).toBeNull();
  });

  test("rejects spaces with a reason naming them", () => {
    expect(tagProblem("Just Chatting")).toBe("Tags can't contain spaces");
  });

  test("rejects punctuation and symbols", () => {
    expect(tagProblem("rock-n-roll")).toBe("Tags can only use letters and numbers");
    expect(tagProblem("C++")).toBe("Tags can only use letters and numbers");
    expect(tagProblem("no_underscores")).toBe("Tags can only use letters and numbers");
  });

  test("rejects over 25 characters but allows exactly 25", () => {
    expect(tagProblem("a".repeat(25))).toBeNull();
    expect(tagProblem("a".repeat(26))).toBe("Tags are limited to 25 characters");
  });

  test("rejects empty", () => {
    expect(tagProblem("")).toBe("A tag can't be empty");
  });
});

describe("addTagProblem", () => {
  test("rejects a case-insensitive duplicate", () => {
    expect(addTagProblem(["English"], "english")).toBe('"english" is already a tag');
  });

  test("rejects an eleventh tag", () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `tag${i}`);
    expect(addTagProblem(full, "another")).toBe("Twitch allows at most 10 tags");
    expect(addTagProblem(full.slice(1), "another")).toBeNull();
  });

  test("reports the tag's own problem before list problems", () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `tag${i}`);
    expect(addTagProblem(full, "has space")).toBe("Tags can't contain spaces");
  });
});

describe("tagsProblem", () => {
  test("accepts a valid list", () => {
    expect(tagsProblem(["English", "Chill"])).toBeNull();
    expect(tagsProblem([])).toBeNull();
  });

  test("finds a duplicate or too many anywhere in the list", () => {
    expect(tagsProblem(["a", "b", "A"])).toBe('"A" is already a tag');
    expect(tagsProblem(Array.from({ length: 11 }, (_, i) => `t${i}`))).toBe("Twitch allows at most 10 tags");
  });
});

describe("titles and counters", () => {
  test("counts code points, not UTF-16 units", () => {
    expect(characterCount("hi 🎮")).toBe(4);
    expect(titleCounter("🎮".repeat(140)).over).toBe(false);
  });

  test("counter reports remaining, near and over", () => {
    expect(titleCounter("abc")).toEqual({ length: 3, max: 140, remaining: 137, over: false, near: false });
    expect(titleCounter("a".repeat(130)).near).toBe(true);
    expect(titleCounter("a".repeat(140))).toMatchObject({ remaining: 0, over: false, near: true });
    expect(titleCounter("a".repeat(141))).toMatchObject({ remaining: -1, over: true, near: false });
  });

  test("counter refuses a nonsense limit", () => {
    expect(() => lengthCounter("x", 0)).toThrow();
  });

  test("titleProblem refuses empty and too long", () => {
    expect(titleProblem("   ")).toBe("The title can't be empty");
    expect(titleProblem("a".repeat(141))).toBe("Titles are limited to 140 characters");
    expect(titleProblem("a".repeat(140))).toBeNull();
  });

  test("marker descriptions cap at 140", () => {
    expect(markerDescriptionProblem("")).toBeNull();
    expect(markerDescriptionProblem("a".repeat(141))).toBe("Marker descriptions are limited to 140 characters");
  });
});

describe("diffStreamInfo", () => {
  test("nothing changed is an empty patch", () => {
    const patch = diffStreamInfo(info(), info());
    expect(patch).toEqual({});
    expect(isEmptyPatch(patch)).toBe(true);
  });

  test("includes only the fields that differ", () => {
    const patch = diffStreamInfo(info(), info({ title: "Ranked grind", category: VALORANT }));
    expect(patch).toEqual({ title: "Ranked grind", game_id: VALORANT.id });
    expect(changedFields(patch)).toEqual(["title", "category"]);
  });

  test("tags compare as a case-insensitive set", () => {
    expect(diffStreamInfo(info(), info({ tags: ["chill", "ENGLISH"] }))).toEqual({});
    expect(diffStreamInfo(info(), info({ tags: ["English"] }))).toEqual({ tags: ["English"] });
    expect(diffStreamInfo(info({ tags: ["a", "b"] }), info({ tags: ["a", "a"] }))).toEqual({ tags: ["a", "a"] });
  });

  test("clearing tags sends an empty list", () => {
    expect(diffStreamInfo(info(), info({ tags: [] }))).toEqual({ tags: [] });
  });

  test("clearing the category sends an empty game_id", () => {
    expect(diffStreamInfo(info(), info({ category: null }))).toEqual({ game_id: "" });
  });

  test("category name or art differences alone are not a change", () => {
    const renamed = info({ category: { ...JUST_CHATTING, name: "Just chatting", boxArtUrl: "x" } });
    expect(diffStreamInfo(info(), renamed)).toEqual({});
  });
});

describe("Helix parsing", () => {
  test("channel info", () => {
    const body = {
      data: [{ broadcaster_id: "1", title: "Hello", game_id: "509658", game_name: "Just Chatting", tags: ["English"] }],
    };
    expect(channelInfoFromHelix(body)).toEqual({ title: "Hello", category: JUST_CHATTING, tags: ["English"] });
  });

  test("channel info without a category or tags", () => {
    expect(channelInfoFromHelix({ data: [{ title: "Hi", game_id: "", game_name: "", tags: null }] })).toEqual({
      title: "Hi",
      category: null,
      tags: [],
    });
  });

  test("no channel", () => {
    expect(channelInfoFromHelix({ data: [] })).toBeNull();
    expect(channelInfoFromHelix(null)).toBeNull();
  });

  test("categories skip malformed rows and size box art", () => {
    const body = {
      data: [
        { id: "509658", name: "Just Chatting", box_art_url: "https://x/ttv-boxart/509658-52x72.jpg" },
        { id: "1", name: "Templated", box_art_url: "https://x/ttv-boxart/1-{width}x{height}.jpg" },
        { id: "2" },
        "junk",
      ],
    };
    expect(categoriesFromHelix(body)).toEqual([
      { id: "509658", name: "Just Chatting", boxArtUrl: "https://x/ttv-boxart/509658-52x72.jpg" },
      { id: "1", name: "Templated", boxArtUrl: "https://x/ttv-boxart/1-52x72.jpg" },
    ]);
  });

  test("sizedBoxArtUrl resizes a filled URL", () => {
    expect(sizedBoxArtUrl("https://x/ttv-boxart/9-52x72.jpg", 104, 144)).toBe("https://x/ttv-boxart/9-104x144.jpg");
  });
});
