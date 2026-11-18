// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures hold engine ${...} expressions as plain strings
import { describe, expect, test } from "bun:test";
import { conditionSetKey, eventConditionIdentity, triggerIdentity } from "./trigger-identity";

const over100 = { field: "${trigger.data.amount}", operator: "gte", value: 100 };
const named = { field: "${trigger.data.userName}", operator: "eq", value: "wolfy" };

describe("conditionSetKey", () => {
  test("the same conditions in another order share a key", () => {
    expect(conditionSetKey([over100, named])).toBe(conditionSetKey([named, over100]));
  });

  test("duplicates collapse, differences stay distinct", () => {
    expect(conditionSetKey([over100, over100])).toBe(conditionSetKey([over100]));
    expect(conditionSetKey([over100])).not.toBe(conditionSetKey([{ ...over100, value: 200 }]));
  });

  test("key order inside a condition does not matter", () => {
    expect(conditionSetKey([{ operator: "gte", value: 100, field: "${trigger.data.amount}" }])).toBe(
      conditionSetKey([over100])
    );
  });
});

describe("triggerIdentity", () => {
  test("agrees with the engine: event, then the sorted condition set, separated by NUL", () => {
    expect(triggerIdentity({ type: "event", event: "channel.cheer", conditions: [named, over100] })).toBe(
      `channel.cheer\0${[JSON.stringify(over100), JSON.stringify(named)].sort().join("\0")}`
    );
  });

  test("order and $ref/order fields do not change identity", () => {
    const a = { $ref: "cheer", type: "event", event: "channel.cheer", order: 0, conditions: [over100, named] };
    const b = { type: "event", event: "channel.cheer", order: 4, conditions: [named, over100] };
    expect(triggerIdentity(a)).toBe(triggerIdentity(b));
  });

  test("a missing event, a non-event trigger or a field merging can't read has no identity", () => {
    expect(triggerIdentity({ type: "event", event: "", conditions: [] })).toBeUndefined();
    expect(triggerIdentity({ type: "schedule", event: "channel.cheer", schedule: "* * * * *" })).toBeUndefined();
    expect(triggerIdentity({ type: "event", event: "channel.cheer", description: "hi" })).toBeUndefined();
  });

  test("an unreadable condition has no identity", () => {
    expect(triggerIdentity({ type: "event", event: "channel.cheer", conditions: ["amount"] })).toBeUndefined();
  });

  test("eventConditionIdentity matches triggerIdentity for the same trigger", () => {
    const conditions = [over100, named];
    expect(eventConditionIdentity("channel.cheer", conditions)).toBe(
      triggerIdentity({ type: "event", event: "channel.cheer", conditions })
    );
  });
});
