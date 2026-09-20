import { describe, expect, test } from "bun:test";
import type { ConfigField, DataShapeField } from "@woofx3/api/ui-schema";
import {
  initialValues,
  payloadFromValues,
  type TestEventField,
  testEventFields,
  valuesFromPayload,
} from "@/lib/test-event-fields";
import type { TriggerPreset } from "@/lib/workflow-presets";

const icon = (() => null) as unknown as TriggerPreset["icon"];

function preset(emits: DataShapeField[], configFields: ConfigField[] = []): TriggerPreset {
  return {
    id: "t",
    name: "Trigger",
    description: "",
    icon,
    category: "General",
    color: "#888",
    emits,
    config: { fields: configFields },
  };
}

/** The shape a test reads most easily: what each field is called and starts at. */
function seeds(fields: TestEventField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.label, field.initial]));
}

describe("testEventFields", () => {
  test("gives every emitted path a field, labelled by its last segment in words", () => {
    const fields = testEventFields(
      preset([
        { path: "fromBroadcasterUserName", type: "string" },
        { path: "viewers", type: "number" },
        { path: "channel.title", type: "string" },
      ])
    );
    expect(fields.map((field) => [field.path, field.label])).toEqual([
      ["fromBroadcasterUserName", "From broadcaster user name"],
      ["viewers", "Viewers"],
      ["channel.title", "Title"],
    ]);
  });

  test("drops a declared parent that its own children describe", () => {
    const fields = testEventFields(
      preset([
        { path: "reward", type: "object" },
        { path: "reward.title", type: "string" },
        { path: "extra", type: "object" },
      ])
    );
    expect(fields.map((field) => field.path)).toEqual(["reward.title", "extra"]);
  });

  test("starts each field at its example, or an empty value of its type", () => {
    const fields = testEventFields(
      preset([
        { path: "amount", type: "number", example: 100 },
        { path: "message", type: "string" },
        { path: "isAnonymous", type: "boolean" },
      ])
    );
    expect(seeds(fields)).toEqual({ Amount: 100, Message: "", "Is anonymous": false });
  });

  // The engine stores an undeclared example as null, and a form opening on
  // `null` asks the user for what the declaration owed them.
  test("treats a null example as no example", () => {
    expect(seeds(testEventFields(preset([{ path: "userName", type: "string", example: null }])))).toEqual({
      "User name": "",
    });
  });

  test("falls back to the same path in an example payload the config carries", () => {
    const fields = testEventFields(
      preset(
        [
          { path: "userName", type: "string" },
          { path: "viewers", type: "number" },
        ],
        [
          {
            id: "minViewers",
            label: "Minimum viewers",
            type: "number",
            eventPath: "viewers",
            examplePayload: '{"userName":"raider99","viewers":50}',
          },
        ]
      )
    );
    expect(seeds(fields)).toEqual({ "User name": "raider99", Viewers: 50 });
  });

  test('ignores a value an example payload elided as "..."', () => {
    const fields = testEventFields(
      preset(
        [{ path: "rewardId", type: "string" }],
        [{ id: "reward", label: "Reward", type: "select", examplePayload: '{"rewardId":"..."}' }]
      )
    );
    expect(seeds(fields)).toEqual({ "Reward id": "" });
  });

  test("ignores an unparseable example payload rather than failing the form", () => {
    const fields = testEventFields(
      preset(
        [{ path: "userName", type: "string" }],
        [{ id: "whatever", label: "Whatever", type: "text", examplePayload: "{not json" }]
      )
    );
    expect(seeds(fields)).toEqual({ "User name": "" });
  });

  test("offers the choices a config select declares for the path, defaulting to its default", () => {
    const options = [
      { value: "1000", label: "Tier 1" },
      { value: "2000", label: "Tier 2" },
    ];
    const [field] = testEventFields(
      preset(
        [{ path: "tier", type: "string" }],
        [{ id: "tier", label: "Subscription tier", type: "select", options, defaultValue: "2000" }]
      )
    );
    expect(field.options).toEqual(options);
    expect(field.initial).toBe("2000");
  });

  test("binds a config field to a path by eventPath before its id", () => {
    const [field] = testEventFields(
      preset(
        [{ path: "amount", type: "number" }],
        [
          {
            id: "minBits",
            label: "Minimum bits",
            type: "select",
            eventPath: "amount",
            options: [{ value: "100", label: "100" }],
          },
        ]
      )
    );
    expect(field.options).toEqual([{ value: "100", label: "100" }]);
  });

  test("has no fields for a trigger that declares nothing", () => {
    expect(testEventFields(preset([]))).toEqual([]);
  });
});

describe("payloadFromValues", () => {
  test("nests dot paths", () => {
    const fields = testEventFields(
      preset([
        { path: "channel.title", type: "string" },
        { path: "channel.viewers", type: "number" },
        { path: "live", type: "boolean" },
      ])
    );
    expect(payloadFromValues(fields, { "channel.title": "hi", "channel.viewers": 3, live: true })).toEqual({
      channel: { title: "hi", viewers: 3 },
      live: true,
    });
  });

  test("round-trips through valuesFromPayload", () => {
    const fields = testEventFields(
      preset([
        { path: "user.name", type: "string", example: "alice" },
        { path: "amount", type: "number", example: 100 },
      ])
    );
    const values = initialValues(fields);
    expect(valuesFromPayload(fields, payloadFromValues(fields, values))).toEqual(values);
  });

  test("reads back only the paths hand-edited JSON actually carries", () => {
    const fields = testEventFields(
      preset([
        { path: "userName", type: "string" },
        { path: "amount", type: "number" },
      ])
    );
    expect(valuesFromPayload(fields, { amount: 42, unrelated: true })).toEqual({ amount: 42 });
  });
});
