import { describe, expect, test } from "bun:test";
import { actionPlacementEntry, taxonomyLabel, triggerMenuAxis } from "@/lib/taxonomy";

describe("taxonomy", () => {
  test("menu axes are found by prefix and validated as segments", () => {
    expect(triggerMenuAxis(["platform.twitch", "alert.subscription.gift"], "alert.")?.segments).toEqual([
      "subscription",
      "gift",
    ]);
    expect(triggerMenuAxis(["alert."], "alert.")).toBeUndefined();
    expect(triggerMenuAxis(["alert.a..b"], "alert.")).toBeUndefined();
  });

  test("placement takes the first well-formed entry whatever its family", () => {
    expect(actionPlacementEntry(["platform.twitch", "tools.counter"])?.segments).toEqual(["platform", "twitch"]);
    expect(actionPlacementEntry(["  ", "  tools . counter  "])?.segments).toEqual(["tools", "counter"]);
    expect(actionPlacementEntry([])).toBeUndefined();
  });

  test("the two policies deliberately disagree about a malformed first entry", () => {
    const taxonomy = ["platform.", "alert.follow"];
    expect(triggerMenuAxis(taxonomy, "alert.")?.segments).toEqual(["follow"]);
    expect(actionPlacementEntry(taxonomy)).toBeUndefined();
  });

  test("known segments keep their owned wording", () => {
    expect(taxonomyLabel("subscriptionGift")).toBe("Subscription Gift");
    expect(taxonomyLabel("obs")).toBe("OBS");
  });
});
