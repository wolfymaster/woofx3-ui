import { describe, expect, test } from "bun:test";
import type { Doc } from "@convex/_generated/dataModel";
import { escapeDollarKeys } from "@/lib/dollar-keys";
import { eventsChangingResource, resourceActionStep, resourceActions } from "@/lib/resource-actions";
import type { ActionPreset } from "@/lib/workflow-presets";

const icon = (() => null) as unknown as ActionPreset["icon"];

function preset(overrides: Partial<ActionPreset>): ActionPreset {
  return {
    id: "row-1",
    name: "Increment counter",
    description: "",
    icon,
    category: "General",
    color: "#888",
    ...overrides,
  };
}

const increment = preset({
  canonicalRef: "woofx3:action:counter.increment",
  handlerType: "function",
  functionCall: "woofx3:function:counter.increment",
  config: { fields: [{ id: "target", label: "Counter", type: "resource_ref", resourceKind: "counter" }] },
});

describe("resourceActionStep", () => {
  test("runs the catalog's action, aimed at the chosen instance", () => {
    const step = resourceActionStep([increment], "woofx3", "counter.increment", { target: "woofx3:counter:deaths" });
    expect(step).toMatchObject({
      action: "function",
      function: "woofx3:function:counter.increment",
      $ref: "woofx3:action:counter.increment",
      parameters: { target: "woofx3:counter:deaths" },
    });
  });

  test("says which module to update when the action is missing", () => {
    expect(() => resourceActionStep([], "woofx3", "counter.increment", {})).toThrow("update the woofx3 module");
  });
});

const addTime = preset({
  id: "row-2",
  name: "Add time to timer",
  functionCall: "woofx3:function:timer.add",
  handlerType: "function",
  config: {
    fields: [
      { id: "target", label: "Timer", type: "resource_ref", resourceKind: "timer" },
      { id: "seconds", label: "Seconds", type: "number" },
    ],
  },
});

const chatReply = preset({
  id: "row-3",
  name: "Send chat message",
  handlerType: "chat.reply",
  config: { fields: [{ id: "message", label: "Message", type: "text" }] },
});

describe("resourceActions", () => {
  test("the actions with a resource_ref field for the kind, by name, with that field", () => {
    expect(
      resourceActions([addTime, increment, chatReply], "counter").map(({ preset, fieldId }) => [preset.name, fieldId])
    ).toEqual([["Increment counter", "target"]]);
  });

  test("an action aimed at another kind is left out", () => {
    expect(resourceActions([increment, chatReply], "timer")).toEqual([]);
  });
});

function workflow(event: string, tasks: unknown[], engineWorkflowId = "wf-1"): Doc<"workflows"> {
  return {
    engineWorkflowId,
    isEnabled: true,
    definition: escapeDollarKeys({ name: event, trigger: { type: "event", event }, tasks }),
  } as Doc<"workflows">;
}

function step(id: string, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "action",
    action: "function",
    function: "woofx3:function:counter.increment",
    parameters,
    ...extra,
  };
}

describe("eventsChangingResource", () => {
  const actions = resourceActions([increment], "counter");
  const deaths = "woofx3:counter:deaths";

  test("the events whose steps aim at this instance, once each, sorted", () => {
    const workflows = [
      workflow("chat.command.death", [step("act_1", { target: deaths })], "wf-1"),
      workflow("channel.raid", [step("act_1", { target: deaths, amount: 5 })], "wf-2"),
      workflow("channel.follow", [step("act_1", { target: "woofx3:counter:wins" })], "wf-3"),
    ];
    expect(eventsChangingResource(workflows, actions, deaths)).toEqual(["channel.raid", "chat.command.death"]);
  });

  test("a step under a condition counts, and a shared step counts", () => {
    const conditional = workflow("channel.cheer", [
      { id: "rule_1", type: "condition", conditions: [{ field: "a", operator: "eq", value: 1 }], onTrue: ["act_1"] },
      step("act_1", { target: deaths }, { dependsOn: ["rule_1"] }),
    ]);
    expect(eventsChangingResource([conditional], actions, deaths)).toEqual(["channel.cheer"]);
  });

  test("a workflow this screen can't project is skipped rather than guessed at", () => {
    const withDelay = workflow("channel.subscribe", [
      { id: "wait_1", type: "delay", parameters: { seconds: 5 } },
      step("act_1", { target: deaths }),
    ]);
    expect(eventsChangingResource([withDelay], actions, deaths)).toEqual([]);
  });

  test("a target chosen at runtime is not claimed as this instance", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
    const dynamic = workflow("channel.raid", [step("act_1", { target: "${trigger.data.counter}" })]);
    expect(eventsChangingResource([dynamic], actions, deaths)).toEqual([]);
  });
});
