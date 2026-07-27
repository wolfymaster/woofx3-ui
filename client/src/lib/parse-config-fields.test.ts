import { describe, expect, test } from "bun:test";
import { parseConfigField, parseConfigFields } from "./parse-config-fields";

describe("parseConfigFields", () => {
  test("parses internal source and eventPath metadata", () => {
    const fields = parseConfigFields([
      {
        id: "rewardId",
        label: "Reward",
        type: "select",
        source: {
          kind: "internal",
          request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
          timeoutMs: 10000,
        },
        eventPath: "rewardId",
        operator: "eq",
        description: "Only fire when the redemption matches this reward.",
        hint: "Loaded from Twitch.",
        dataSchema: '{"rewardId":"..."}',
      },
    ]);
    expect(fields).toHaveLength(1);
    expect(fields[0].source).toEqual({
      kind: "internal",
      request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
      timeoutMs: 10000,
    });
    expect(fields[0].eventPath).toBe("rewardId");
    expect(fields[0].operator).toBe("eq");
    expect(fields[0].description).toBe("Only fire when the redemption matches this reward.");
  });

  test("normalizes boolean to toggle", () => {
    const [f] = parseConfigFields([{ id: "x", label: "X", type: "boolean" }]);
    expect(f.type).toBe("toggle");
  });

  test("maps resource_ref field's resourceKind property (actual engine wire shape)", () => {
    const [f] = parseConfigFields([{ id: "counter", label: "Counter", type: "resource_ref", resourceKind: "counter" }]);
    expect(f.type).toBe("resource_ref");
    expect(f.resourceKind).toBe("counter");
  });

  test("falls back to a resource_ref field's kind property", () => {
    const [f] = parseConfigFields([{ id: "counter", label: "Counter", type: "resource_ref", kind: "counter" }]);
    expect(f.type).toBe("resource_ref");
    expect(f.resourceKind).toBe("counter");
  });

  test("parseConfigField drops unknown types", () => {
    expect(parseConfigField({ id: "x", label: "X", type: "unknown" })).toBeNull();
  });
});
