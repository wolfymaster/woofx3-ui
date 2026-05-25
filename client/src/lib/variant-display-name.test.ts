import { describe, expect, test } from "bun:test";
import { suggestVariantDisplayName } from "./variant-display-name";
import type { TriggerPreset } from "./workflow-presets";

const cheerTrigger = {
  id: "cheer.user.twitch",
  name: "Cheer",
  description: "Cheer",
  category: "Twitch",
  color: "",
  config: {
    fields: [
      {
        id: "amount",
        label: "Minimum bits",
        type: "number" as const,
        eventPath: "amount",
        operator: "gte" as const,
        unit: "bits",
      },
    ],
  },
} as TriggerPreset;

describe("suggestVariantDisplayName", () => {
  test("includes trigger name and formatted field value", () => {
    const name = suggestVariantDisplayName(cheerTrigger, { amount: 100 }, []);
    expect(name).toBe("Cheer — 100 bits");
  });

  test("deduplicates when name already exists", () => {
    const name = suggestVariantDisplayName(cheerTrigger, { amount: 100 }, ["Cheer — 100 bits"]);
    expect(name).toBe("Cheer — 100 bits (2)");
  });
});
