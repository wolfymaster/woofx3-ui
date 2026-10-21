import { describe, expect, test } from "bun:test";
import { getDefaultConfigValues } from "./workflow-presets";
import {
  ANY_CONDITION,
  conditionsToFieldValues,
  fieldValuesToConditions,
  incompleteConditionFields,
} from "./workflow-presets-json";

describe("fieldValuesToConditions", () => {
  test("range field emits between", () => {
    const fields = [{ id: "amount", label: "Amount", type: "range" as const, eventPath: "amount" }];
    const conds = fieldValuesToConditions(fields, {
      amount: { type: "range", min: 10, max: 20 },
    });
    expect(conds[0]).toMatchObject({
      field: "${trigger.data.amount}",
      operator: "between",
      value: [10, 20],
    });
  });
});

describe("conditionsToFieldValues", () => {
  test("recovers a scalar field value from its condition", () => {
    const fields = [{ id: "amount", label: "Minimum bits", type: "number" as const, eventPath: "amount" }];
    const values = conditionsToFieldValues(fields, [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }]);
    expect(values.amount).toBe(100);
  });

  test("recovers a range field value from a between condition", () => {
    const fields = [{ id: "amount", label: "Amount", type: "range" as const, eventPath: "amount" }];
    const values = conditionsToFieldValues(fields, [
      { field: "${trigger.data.amount}", operator: "between", value: [10, 20] },
    ]);
    expect(values.amount).toEqual({ type: "range", min: 10, max: 20 });
  });

  test("reads a field with no condition as Any, not as its default", () => {
    const fields = [
      { id: "amount", label: "Minimum bits", type: "number" as const, eventPath: "amount", defaultValue: 100 },
    ];
    const values = conditionsToFieldValues(fields, []);
    expect(values.amount).toBe(ANY_CONDITION);
    expect(fieldValuesToConditions(fields, values)).toEqual([]);
  });

  test("round-trips through fieldValuesToConditions", () => {
    const fields = [{ id: "rewardId", label: "Reward", type: "select" as const, eventPath: "rewardId" }];
    const conditions = fieldValuesToConditions(fields, { rewardId: "abc" });
    expect(conditionsToFieldValues(fields, conditions)).toEqual({ rewardId: "abc" });
  });
});

describe("incompleteConditionFields", () => {
  const fields = [
    { id: "amount", label: "Minimum bits", type: "number" as const, eventPath: "amount" },
    { id: "tier", label: "Tier", type: "select" as const, eventPath: "tier" },
    { id: "gifted", label: "Gifted", type: "toggle" as const, eventPath: "isGift" },
  ];

  test("flags a field left empty, but not one switched to Any or holding a falsy value", () => {
    const incomplete = incompleteConditionFields(fields, { amount: "", tier: ANY_CONDITION, gifted: false });
    expect(incomplete.map((field) => field.id)).toEqual(["amount"]);
  });

  test("flags a field with no value at all", () => {
    expect(incompleteConditionFields(fields, { amount: 0, gifted: true }).map((field) => field.id)).toEqual(["tier"]);
  });
});

describe("a field offering a choice of comparison", () => {
  const fields = [
    {
      id: "amount",
      label: "Bits",
      type: "number" as const,
      eventPath: "amount",
      operator: "gte" as const,
      operators: ["gte" as const, "eq" as const],
      defaultValue: 100,
    },
  ];

  test("starts on the field's default comparison and amount", () => {
    expect(getDefaultConfigValues(fields)).toEqual({ amount: { operator: "gte", value: 100 } });
  });

  test("saves the chosen comparison and reads it back", () => {
    const conditions = fieldValuesToConditions(fields, { amount: { operator: "eq", value: 69 } });
    expect(conditions).toEqual([{ field: "${trigger.data.amount}", operator: "eq", value: 69 }]);
    expect(conditionsToFieldValues(fields, conditions)).toEqual({ amount: { operator: "eq", value: 69 } });
  });

  test("keeps a saved comparison the field does not offer", () => {
    const values = conditionsToFieldValues(fields, [{ field: "${trigger.data.amount}", operator: "lte", value: 5 }]);
    expect(values.amount).toEqual({ operator: "lte", value: 5 });
  });

  test("treats a cleared amount as incomplete and saves no condition for it", () => {
    const values = { amount: { operator: "eq" as const, value: "" as const } };
    expect(incompleteConditionFields(fields, values).map((field) => field.id)).toEqual(["amount"]);
    expect(fieldValuesToConditions(fields, values)).toEqual([]);
  });
});
