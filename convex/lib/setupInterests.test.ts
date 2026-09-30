import { describe, expect, test } from "bun:test";
import { availableInterests, buildDashboardPreset, starterPacksForInterests } from "./setupInterests";
import { findStarterPack } from "./starterPacks";

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

describe("buildDashboardPreset", () => {
  const zonesOf = (widgets: ReturnType<typeof buildDashboardPreset>) => new Set(widgets.map((w) => w.zoneId));

  test("fills every zone when no interests are chosen", () => {
    const widgets = buildDashboardPreset([]);
    expect(zonesOf(widgets)).toEqual(new Set(["0-0", "0-1", "0-2"]));
  });

  test("docks the macro pad for chat commands and moves stream status to the controls", () => {
    const widgets = buildDashboardPreset(["chat-commands"]);
    expect(widgets.find((w) => w.zoneId === "0-0")?.type).toBe("macro-pad");
    expect(widgets.filter((w) => w.zoneId === "0-2").map((w) => w.type)).toContain("stream-status");
  });

  test("gives each widget a slot id unique on the panel", () => {
    const widgets = buildDashboardPreset([
      "thank-followers-raiders",
      "celebrate-subs-cheers",
      "chat-commands",
      "switch-obs-scenes",
      "manage-stream",
    ]);
    expect(new Set(widgets.map((w) => w.slotId)).size).toBe(widgets.length);
  });

  test("stacks at most three widgets in a zone", () => {
    const widgets = buildDashboardPreset(["chat-commands", "manage-stream", "switch-obs-scenes"]);
    const controls = widgets.filter((w) => w.zoneId === "0-2");
    expect(controls.length).toBe(3);
  });
});
