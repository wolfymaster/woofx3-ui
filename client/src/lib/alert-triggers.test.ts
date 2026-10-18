// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures hold engine ${...} expressions as plain strings
import { describe, expect, test } from "bun:test";
import type { Doc } from "@convex/_generated/dataModel";
import type { ConditionConfig, WorkflowDefinition } from "@woofx3/api";
import {
  eventTriggers,
  isPinnedTo,
  newTriggerTree,
  nextTriggerOrder,
  SEED_STEP_ID,
  triggerAimsAt,
  withFieldConditions,
} from "@/lib/alert-triggers";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { resourceActions } from "@/lib/resource-actions";
import type { ActionPreset, ConfigField, TriggerPreset } from "@/lib/workflow-presets";
import { definitionToTree, treeToDefinition } from "@/lib/workflow-tree";

const icon = (() => null) as unknown as ActionPreset["icon"];

function row(
  engineWorkflowId: string,
  trigger: Record<string, unknown>,
  tasks: unknown[] = [],
  createdAt = 0
): Doc<"workflows"> {
  return {
    _id: `doc-${engineWorkflowId}`,
    _creationTime: 0,
    instanceId: "instance",
    engineWorkflowId,
    definition: escapeDollarKeys({ id: engineWorkflowId, name: engineWorkflowId, trigger, tasks }),
    isEnabled: true,
    createdAt,
    updatedAt: 0,
  } as unknown as Doc<"workflows">;
}

const cheer = (extra: Record<string, unknown> = {}) => ({ type: "event", event: "channel.cheer", ...extra });

const amount: ConfigField = { id: "amount", label: "Bits", type: "number", required: true } as ConfigField;
const counterField: ConfigField = {
  id: "counter",
  label: "Counter",
  type: "resource_ref",
  resourceKind: "counter",
} as ConfigField;

describe("eventTriggers", () => {
  test("lists the event's workflows in the order the engine runs them", () => {
    const workflows = [
      row("free-late", cheer(), [], 20),
      row("b", cheer({ order: 1 })),
      row("follow", { type: "event", event: "channel.follow", order: 0 }),
      row("free-early", cheer(), [], 10),
      row("c", cheer({ order: 1 })),
      row("a", cheer({ order: 0 })),
    ];
    expect(eventTriggers(workflows, "channel.cheer").map((t) => t.row.engineWorkflowId)).toEqual([
      "a",
      "b",
      "c",
      "free-early",
      "free-late",
    ]);
  });

  test("reads the trigger's conditions with their dollar keys restored", () => {
    const conditions = [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }];
    const [trigger] = eventTriggers([row("a", cheer({ conditions }))], "channel.cheer");
    expect(trigger.conditions).toEqual(conditions as ConditionConfig[]);
  });
});

describe("nextTriggerOrder", () => {
  test("goes after the last ordered trigger, ignoring unordered ones", () => {
    const triggers = eventTriggers([row("a", cheer({ order: 3 })), row("b", cheer())], "channel.cheer");
    expect(nextTriggerOrder(triggers)).toBe(4);
    expect(nextTriggerOrder([])).toBe(0);
  });
});

describe("withFieldConditions", () => {
  test("rewrites the fields' conditions and keeps the ones no field owns", () => {
    const foreign: ConditionConfig = { field: "${trigger.data.anonymous}", operator: "eq", value: false };
    const stale: ConditionConfig = { field: "${trigger.data.amount}", operator: "eq", value: 5 };
    expect(withFieldConditions([foreign, stale], [amount], { amount: 100 })).toEqual([
      foreign,
      { field: "${trigger.data.amount}", operator: "eq", value: 100 },
    ]);
  });

  test("a field switched to Any drops its condition", () => {
    const stale: ConditionConfig = { field: "${trigger.data.amount}", operator: "eq", value: 5 };
    expect(withFieldConditions([stale], [amount], { amount: null })).toEqual([]);
  });
});

const increment: ActionPreset = {
  id: "row-1",
  name: "Increment counter",
  description: "",
  icon,
  category: "General",
  color: "#888",
  handlerType: "function",
  functionCall: "woofx3:function:counter.increment",
  config: {
    fields: [
      { id: "target", label: "Counter", type: "resource_ref", resourceKind: "counter" },
      { id: "amount", label: "Amount", type: "number", min: 1 },
    ] as ConfigField[],
  },
};

describe("scopes", () => {
  test("a trigger is pinned to an instance by its condition", () => {
    const [pinned, other] = eventTriggers(
      [
        row(
          "a",
          cheer({ order: 0, conditions: [{ field: "${trigger.data.counter}", operator: "eq", value: "deaths" }] })
        ),
        row("b", cheer({ order: 1 })),
      ],
      "channel.cheer"
    );
    const pin = { fieldId: "counter", value: "deaths" };
    expect(isPinnedTo(pinned, [counterField], pin)).toBe(true);
    expect(isPinnedTo(other, [counterField], pin)).toBe(false);
  });

  test("a trigger aims at an instance from a step inside a condition", () => {
    const step = {
      id: "inc",
      type: "action",
      action: "function",
      function: "woofx3:function:counter.increment",
      parameters: { target: "deaths" },
    };
    const [trigger] = eventTriggers(
      [
        row("a", cheer(), [
          {
            id: "check",
            type: "condition",
            conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 1 }],
            onTrue: ["inc"],
          },
          { ...step, dependsOn: ["check"] },
        ]),
      ],
      "channel.cheer"
    );
    const actions = resourceActions([increment], "counter");
    expect(triggerAimsAt(trigger, actions, "deaths")).toBe(true);
    expect(triggerAimsAt(trigger, actions, "wins")).toBe(false);
  });
});

describe("newTriggerTree", () => {
  const preset: TriggerPreset = {
    id: "trigger-row",
    canonicalRef: "twitch:trigger:cheer",
    name: "Cheer",
    description: "",
    icon,
    category: "Twitch",
    color: "#888",
    event: "channel.cheer",
  } as TriggerPreset;

  test("starts at the given order, pinned, with no steps", () => {
    const tree = newTriggerTree({
      triggerPreset: preset,
      conditionFields: [counterField],
      order: 2,
      pin: { fieldId: "counter", value: "deaths" },
    });
    const definition = treeToDefinition(tree);
    expect(definition.trigger).toEqual({
      type: "event",
      event: "channel.cheer",
      $ref: "twitch:trigger:cheer",
      conditions: [{ field: "${trigger.data.counter}", operator: "eq", value: "deaths" }],
      order: 2,
    } as never);
    expect(definition.tasks).toEqual([]);
  });

  test("a seeded step aimed at an instance carries no other settings", () => {
    const tree = newTriggerTree({
      triggerPreset: preset,
      conditionFields: [],
      order: 0,
      seed: increment,
      aim: { fieldId: "target", value: "deaths" },
    });
    expect(tree.steps).toHaveLength(1);
    const [step] = tree.steps;
    expect(step.id).toBe(SEED_STEP_ID);
    expect(step.type === "action" && step.parameters).toEqual({ target: "deaths" });
  });
});

describe("a trigger split from a workflow of several", () => {
  // The shape the engine's 0065_split_alert_workflows migration writes for one trigger.
  const split = {
    id: "wf-cheer",
    name: "Cheer triggers (2)",
    trigger: {
      type: "event",
      event: "channel.cheer",
      $ref: "twitch:trigger:cheer",
      conditions: [{ field: "${trigger.data.amount}", operator: "gte", value: 100 }],
      order: 1,
    },
    tasks: [
      { id: "act_2", type: "action", action: "function", function: "obs:function:flash", parameters: {} },
      { id: "act_3", type: "action", action: "alert", parameters: { layout: { widgets: [] } }, dependsOn: ["act_2"] },
    ],
  };

  test("opens in the step editor and saves back unchanged", () => {
    const read = definitionToTree(split as unknown as WorkflowDefinition);
    expect(read.editable).toBe(true);
    if (read.editable) {
      expect(treeToDefinition(read.tree)).toEqual(split as unknown as WorkflowDefinition);
    }
  });
});
