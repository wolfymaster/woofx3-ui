import { describe, expect, test } from "bun:test";
import { assetsOfKinds, manifestAssets } from "./module-assets";

describe("manifestAssets", () => {
  test.each([
    ["no manifest", null, []],
    ["no assets", { id: "cozy" }, []],
    ["assets not a list", { assets: "widgets/" }, []],
  ])("%s answers nothing", (_name, manifest, expected) => {
    expect(manifestAssets(manifest, "cozy")).toEqual(expected);
  });

  test("names each declared asset by its canonical id, skipping entries without an id or a name", () => {
    const manifest = {
      assets: [
        { id: "bell", name: "Bell", path: "assets/bell.mp3", kind: "audio", description: "Ding" },
        { id: "logo", name: "Logo", path: "assets/logo.png", kind: "" },
        { id: "", name: "Nameless id", path: "x" },
        { id: "unnamed", path: "y" },
        "not an object",
      ],
    };
    expect(manifestAssets(manifest, "cozy")).toEqual([
      { canonicalId: "cozy:asset:bell", name: "Bell", kind: "audio", description: "Ding" },
      { canonicalId: "cozy:asset:logo", name: "Logo" },
    ]);
  });
});

describe("assetsOfKinds", () => {
  const assets = [
    { name: "Zap", kind: "audio" },
    { name: "Bell", kind: "audio" },
    { name: "Logo", kind: "image" },
    { name: "Notes" },
  ];

  test("without kinds, every asset, by name", () => {
    expect(assetsOfKinds(assets, undefined).map((a) => a.name)).toEqual(["Bell", "Logo", "Notes", "Zap"]);
    expect(assetsOfKinds(assets, []).map((a) => a.name)).toEqual(["Bell", "Logo", "Notes", "Zap"]);
  });

  test("with kinds, only assets of those kinds", () => {
    expect(assetsOfKinds(assets, ["audio"]).map((a) => a.name)).toEqual(["Bell", "Zap"]);
  });
});
