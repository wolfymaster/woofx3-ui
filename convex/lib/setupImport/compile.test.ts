import { describe, expect, test } from "bun:test";
import type { StarterCatalog } from "../starterPacks";
import { compileCommandActions, compileWorkflow, missingRequirementMessage } from "./compile";
import type { ImportItem, ImportStep, ImportWorkflowSpec } from "./types";

const catalog: StarterCatalog = {
  triggers: [
    { event: "channel.raid", canonicalRef: "woofx3_twitch:trigger:channel_raid" },
    { event: "chat.command.*", canonicalRef: "woofx3:trigger:chat_command" },
  ],
  actions: [
    { canonicalRef: "woofx3:action:chat.reply", handlerType: "chat.reply" },
    { canonicalRef: "woofx3:action:counter.increment", handlerType: "function", functionCall: "counter.increment" },
    { canonicalRef: "woofx3_twitch:action:twitch.shoutout", handlerType: "function", functionCall: "shoutout" },
  ],
};

const say = (message: string): ImportStep => ({
  kind: "action",
  label: "Send chat message",
  ref: "woofx3:action:chat.reply",
  parameters: { message },
});

function workflow(spec: Partial<ImportWorkflowSpec>): ImportWorkflowSpec {
  return {
    name: "Raid",
    description: "",
    enabled: true,
    trigger: { kind: "event", event: "channel.raid", conditions: [], logic: "and" },
    steps: [],
    ...spec,
  };
}

describe("compileWorkflow", () => {
  test("chains steps in order and resolves refs against the catalog", () => {
    const definition = compileWorkflow(
      workflow({
        steps: [
          say("hi"),
          { kind: "delay", label: "Wait 2s", ms: 2000 },
          {
            kind: "action",
            label: "Shout out",
            ref: "woofx3_twitch:action:twitch.shoutout",
            parameters: { user: "${trigger.data.fromBroadcasterUserId}" },
          },
        ],
      }),
      catalog,
      new Map()
    );
    expect(definition.trigger).toEqual({
      type: "event",
      event: "channel.raid",
      conditions: [],
      $ref: "woofx3_twitch:trigger:channel_raid",
    });
    expect(definition.tasks).toEqual([
      {
        id: "send-chat-message-1",
        type: "action",
        action: "chat.reply",
        parameters: { message: "hi" },
        $ref: "woofx3:action:chat.reply",
      },
      { id: "wait-2s-2", type: "wait", wait: { type: "delay", durationMs: 2000 }, dependsOn: ["send-chat-message-1"] },
      {
        id: "shout-out-3",
        type: "action",
        action: "function",
        function: "shoutout",
        parameters: { user: "${trigger.data.fromBroadcasterUserId}" },
        $ref: "woofx3_twitch:action:twitch.shoutout",
        dependsOn: ["wait-2s-2"],
      },
    ]);
  });

  test("a branch lists every task under each side, nested ones included", () => {
    const definition = compileWorkflow(
      workflow({
        steps: [
          {
            kind: "branch",
            label: "If/else",
            conditions: [{ field: "${trigger.data.viewers}", operator: "gt", value: 10 }],
            logic: "and",
            whenTrue: [
              say("big"),
              {
                kind: "branch",
                label: "If/else",
                conditions: [{ field: "${trigger.data.viewers}", operator: "gt", value: 100 }],
                logic: "and",
                whenTrue: [say("huge")],
                whenFalse: [],
              },
            ],
            whenFalse: [say("small")],
          },
          say("after"),
        ],
      }),
      catalog,
      new Map()
    );
    const [outer, big, inner, huge, small, after] = definition.tasks;
    expect(outer.type).toBe("condition");
    expect(outer.onTrue).toEqual([big.id, inner.id, huge.id]);
    expect(outer.onFalse).toEqual([small.id]);
    expect(inner.onTrue).toEqual([huge.id]);
    expect(after.dependsOn).toEqual([small.id]);
  });

  test("filters where any may pass become a branch around the steps", () => {
    const conditions = [
      { field: "${trigger.data.viewers}", operator: "gt" as const, value: 10 },
      { field: "${trigger.data.fromBroadcasterUserName}", operator: "eq" as const, value: "friend" },
    ];
    const definition = compileWorkflow(
      workflow({ trigger: { kind: "event", event: "channel.raid", conditions, logic: "or" }, steps: [say("hi")] }),
      catalog,
      new Map()
    );
    expect(definition.trigger).toMatchObject({ conditions: [] });
    expect(definition.tasks[0]).toMatchObject({ type: "condition", conditions, conditionLogic: "or" });
  });

  test("binds a command's workflow to the chat command trigger", () => {
    const definition = compileWorkflow(
      workflow({
        trigger: { kind: "event", event: "chat.command.hug", conditions: [], logic: "and" },
        steps: [say("x")],
      }),
      catalog,
      new Map()
    );
    expect(definition.trigger).toMatchObject({ event: "chat.command.hug", $ref: "woofx3:trigger:chat_command" });
  });

  test("schedules carry no trigger ref", () => {
    const definition = compileWorkflow(
      workflow({ trigger: { kind: "schedule", schedule: "@every 600s" }, steps: [say("x")] }),
      catalog,
      new Map()
    );
    expect(definition.trigger).toEqual({ type: "schedule", schedule: "@every 600s" });
  });
});

describe("compileCommandActions", () => {
  test("fills counter references with the counter's canonical id", () => {
    const actions = compileCommandActions(
      [
        {
          kind: "action",
          label: "Increase counter",
          ref: "woofx3:action:counter.increment",
          parameters: { target: { counterKey: "firebot:counter:k" }, amount: 1 },
        },
      ],
      catalog,
      new Map([["firebot:counter:k", "woofx3:counter:deaths"]])
    );
    expect(actions).toEqual([
      {
        id: "increase-counter-1",
        action: "function",
        function: "counter.increment",
        parameters: { target: "woofx3:counter:deaths", amount: 1 },
        $ref: "woofx3:action:counter.increment",
      },
    ]);
  });
});

describe("missingRequirementMessage", () => {
  const item = (steps: ImportStep[], event = "channel.raid"): ImportItem => ({
    key: "k",
    name: "n",
    origin: "o",
    notes: [],
    kind: "workflow",
    spec: workflow({ trigger: { kind: "event", event, conditions: [], logic: "and" }, steps }),
  });

  test("is null when the catalog has everything", () => {
    expect(missingRequirementMessage(item([say("x")]), catalog)).toBeNull();
  });

  test("names a module that is missing, or installed but older", () => {
    const obs: ImportStep = {
      kind: "action",
      label: "Switch OBS scene",
      ref: "woofx3_obs:action:obs.switch_scene",
      parameters: { sceneName: "BRB" },
    };
    expect(missingRequirementMessage(item([obs]), catalog)).toBe("Needs the OBS module.");
    expect(missingRequirementMessage(item([say("x")], "channel.follow"), catalog)).toBe(
      "Needs a newer version of the Twitch module."
    );
  });
});
