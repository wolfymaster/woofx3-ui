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
        examplePayload: '{"rewardId":"..."}',
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

  // The contract's type list is closed and barkloader validates it at install, so an
  // unrecognised type means a malformed declaration rather than a dialect to translate.
  // `boolean` was the one the old parser rewrote to `toggle`; no manifest declares it.
  test("drops a field whose type is not in the contract", () => {
    expect(parseConfigFields([{ id: "x", label: "X", type: "boolean" }])).toEqual([]);
  });

  test("maps resource_ref field's resourceKind property (actual engine wire shape)", () => {
    const [f] = parseConfigFields([{ id: "counter", label: "Counter", type: "resource_ref", resourceKind: "counter" }]);
    expect(f.type).toBe("resource_ref");
    expect(f.resourceKind).toBe("counter");
  });

  test("parseConfigField drops unknown types", () => {
    expect(parseConfigField({ id: "x", label: "X", type: "unknown" })).toBeNull();
  });
});
