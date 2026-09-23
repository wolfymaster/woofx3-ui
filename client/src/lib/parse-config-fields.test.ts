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

describe("list fields", () => {
  test("parses a list with the fields of its rows", () => {
    const [field] = parseConfigFields([
      {
        id: "goals",
        label: "Goals",
        type: "list",
        itemFields: [
          { id: "value", label: "Goal", type: "number", required: true },
          { id: "name", label: "Name", type: "text" },
        ],
      },
    ]);
    expect(field.type).toBe("list");
    expect(field.itemFields?.map((item) => [item.id, item.type, item.required])).toEqual([
      ["value", "number", true],
      ["name", "text", false],
    ]);
  });

  test("drops row fields a row cannot hold, and a list left with none", () => {
    const fields = parseConfigFields([
      {
        id: "goals",
        label: "Goals",
        type: "list",
        itemFields: [
          { id: "value", label: "Goal", type: "number" },
          { id: "counter", label: "Counter", type: "resource_ref", resourceKind: "counter" },
        ],
      },
      { id: "empty", label: "Empty", type: "list", itemFields: [] },
      { id: "missing", label: "Missing", type: "list" },
    ]);
    expect(fields.map((field) => field.id)).toEqual(["goals"]);
    expect(fields[0].itemFields?.map((item) => item.id)).toEqual(["value"]);
  });
});
