import { describe, expect, test } from "bun:test";
import type { StreamInfo } from "@convex/lib/streamInfo";
import { comparePreset, draftProblem, formatStreamPosition, isDirty, rebaseDraft } from "./stream-info-edit";

const JUST_CHATTING = { id: "509658", name: "Just Chatting" };
const VALORANT = { id: "516575", name: "VALORANT" };

function info(overrides: Partial<StreamInfo> = {}): StreamInfo {
  return { title: "Chill stream", category: JUST_CHATTING, tags: ["English"], ...overrides };
}

describe("rebaseDraft", () => {
  test("an untouched draft follows a fresh read", () => {
    const fresh = info({ title: "Changed on Twitch" });
    expect(rebaseDraft(info(), info(), fresh)).toBe(fresh);
  });

  test("an edited draft survives a fresh read", () => {
    const draft = info({ title: "Typing..." });
    expect(rebaseDraft(info(), draft, info({ title: "Changed on Twitch" }))).toBe(draft);
  });

  test("a tag reorder is not an edit", () => {
    const saved = info({ tags: ["a", "b"] });
    const fresh = info({ tags: ["c"] });
    expect(rebaseDraft(saved, info({ tags: ["b", "a"] }), fresh)).toBe(fresh);
  });
});

describe("isDirty and draftProblem", () => {
  test("dirty when any field differs", () => {
    expect(isDirty(info(), info())).toBe(false);
    expect(isDirty(info(), info({ category: VALORANT }))).toBe(true);
  });

  test("reports title before tags", () => {
    expect(draftProblem(info({ title: "", tags: ["bad tag"] }))).toBe("The title can't be empty");
    expect(draftProblem(info({ tags: ["bad tag"] }))).toBe("Tags can't contain spaces");
    expect(draftProblem(info())).toBeNull();
  });
});

describe("comparePreset", () => {
  test("a matching preset is active", () => {
    expect(comparePreset(info(), info({ tags: ["english"] }))).toEqual({ active: true, summary: "Already applied" });
  });

  test("lists what would change", () => {
    expect(comparePreset(info(), info({ title: "Ranked" })).summary).toBe("Changes title");
    expect(comparePreset(info(), info({ title: "Ranked", category: VALORANT })).summary).toBe(
      "Changes title and category"
    );
    expect(comparePreset(info(), info({ title: "Ranked", category: VALORANT, tags: [] })).summary).toBe(
      "Changes title, category and tags"
    );
  });
});

describe("formatStreamPosition", () => {
  test("under and over an hour", () => {
    expect(formatStreamPosition(0)).toBe("0:00");
    expect(formatStreamPosition(83)).toBe("1:23");
    expect(formatStreamPosition(3600 + 23 * 60 + 5)).toBe("1:23:05");
  });

  test("refuses nonsense", () => {
    expect(() => formatStreamPosition(-1)).toThrow();
    expect(() => formatStreamPosition(Number.NaN)).toThrow();
  });
});
