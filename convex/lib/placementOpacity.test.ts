import { describe, expect, it } from "bun:test";
import { rescalePlacements } from "./placementOpacity";

describe("rescalePlacements", () => {
  it("rescales a percent opacity on placements nested anywhere", () => {
    const definition = {
      steps: [{ type: "alert", parameters: { layout: { widgets: [{ widgetCanonicalId: "a", opacity: 100 }] } } }],
    };
    const result = rescalePlacements(definition);
    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      steps: [{ type: "alert", parameters: { layout: { widgets: [{ widgetCanonicalId: "a", opacity: 1 }] } } }],
    });
  });

  it("leaves fractions, missing opacity and non-placements as they are", () => {
    const value = [{ widgetCanonicalId: "a", opacity: 0.5 }, { widgetCanonicalId: "b" }, { opacity: 100 }];
    const result = rescalePlacements(value);
    expect(result.changed).toBe(false);
    expect(result.value).toBe(value);
  });
});
