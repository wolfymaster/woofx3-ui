import { describe, expect, test } from "bun:test";
import { findStarterPack } from "@shared/starter-packs";
import { availableInterests, starterPacksForInterests } from "./setupInterests";

const TWITCH = "woofx3_twitch";
const OBS = "woofx3_obs";

describe("availableInterests", () => {
  test("offers only interests whose modules were chosen", () => {
    expect(availableInterests([TWITCH]).map((i) => i.id)).toEqual([
      "thank-followers-raiders",
      "celebrate-subs-cheers",
      "chat-commands",
      "manage-stream",
    ]);
    expect(availableInterests([TWITCH, OBS]).map((i) => i.id)).toContain("switch-obs-scenes");
  });
});

describe("starterPacksForInterests", () => {
  test("lists each pack once, in interest order", () => {
    expect(starterPacksForInterests(["celebrate-subs-cheers", "thank-followers-raiders"], [TWITCH])).toEqual([
      "follower-thanks",
      "raid-welcome",
      "sub-hype",
      "cheer-thanks",
    ]);
  });

  test("skips interests whose modules were not chosen", () => {
    expect(starterPacksForInterests(["switch-obs-scenes"], [TWITCH])).toEqual([]);
    expect(starterPacksForInterests(["switch-obs-scenes"], [TWITCH, OBS])).toEqual(["brb-scene"]);
  });

  test("ignores unknown interest ids", () => {
    expect(starterPacksForInterests(["nope"], [TWITCH])).toEqual([]);
  });

  test("names only starter packs that exist", () => {
    const every = starterPacksForInterests(
      ["thank-followers-raiders", "celebrate-subs-cheers", "chat-commands", "switch-obs-scenes"],
      [TWITCH, OBS]
    );
    for (const packId of every) {
      expect(findStarterPack(packId)).toBeDefined();
    }
  });
});
