import { describe, expect, test } from "bun:test";
import { alertTargetChoices } from "@/lib/alert-target";

describe("alertTargetChoices", () => {
  const names = ["default", "overlay", "sidebar"];

  test("selects the default for a blank or missing value", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(alertTargetChoices(names, value)).toEqual({ selected: "default", options: names, stale: null });
    }
  });

  test("selects a stored name some scene has", () => {
    expect(alertTargetChoices(names, "sidebar")).toEqual({ selected: "sidebar", options: names, stale: null });
  });

  test("matches a stored name after trimming, as widget names are trimmed", () => {
    expect(alertTargetChoices(names, " sidebar ")).toEqual({ selected: "sidebar", options: names, stale: null });
  });

  test("keeps a name no scene has as the first option, flagged stale", () => {
    expect(alertTargetChoices(names, "sidebr")).toEqual({
      selected: "sidebr",
      options: ["sidebr", ...names],
      stale: "sidebr",
    });
  });

  test("keeps a stored variable reference through the stale path", () => {
    const choices = alertTargetChoices(names, "{widget}");
    expect(choices.selected).toBe("{widget}");
    expect(choices.stale).toBe("{widget}");
  });

  test("offers the default even when the names leave it out", () => {
    expect(alertTargetChoices(["sidebar"], "")).toEqual({
      selected: "default",
      options: ["default", "sidebar"],
      stale: null,
    });
  });

  test("offers only the stored value, unjudged, while the names load", () => {
    expect(alertTargetChoices(undefined, "sidebr")).toEqual({ selected: "sidebr", options: ["sidebr"], stale: null });
    expect(alertTargetChoices(undefined, "")).toEqual({ selected: "default", options: ["default"], stale: null });
  });
});
