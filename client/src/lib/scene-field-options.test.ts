import { describe, expect, it } from "bun:test";
import { placementChoices, sceneChoices } from "@/lib/scene-field-options";

const scenes = [
  {
    engineSceneId: "eng-2",
    name: "Starting soon",
    widgets: [
      { id: "w1", name: "Countdown", widgetCanonicalId: "woofx3:widget:timer", zIndex: 0 },
      { id: "w2", name: "", widgetCanonicalId: "woofx3:widget:text", zIndex: 2 },
      { id: "w3", name: "  ", widgetCanonicalId: "woofx3:widget:text", zIndex: 1 },
    ],
  },
  { engineSceneId: "eng-1", name: "Gameplay", widgets: [] },
  { name: "Not synced yet", widgets: [] },
];

describe("sceneChoices", () => {
  it("lists the scenes the engine knows, by name", () => {
    expect(sceneChoices(scenes)).toEqual([
      { value: "eng-1", label: "Gameplay" },
      { value: "eng-2", label: "Starting soon" },
    ]);
  });
});

describe("placementChoices", () => {
  it("lists the chosen scene's widgets topmost first, naming unnamed ones apart", () => {
    expect(placementChoices(scenes, "eng-2")).toEqual([
      { value: "w2", label: "text #3" },
      { value: "w3", label: "text #2" },
      { value: "w1", label: "Countdown" },
    ]);
  });

  it("is empty with no scene chosen, or one that is gone", () => {
    expect(placementChoices(scenes, undefined)).toEqual([]);
    expect(placementChoices(scenes, "eng-9")).toEqual([]);
  });
});
