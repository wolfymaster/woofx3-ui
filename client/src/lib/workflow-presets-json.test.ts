import { describe, expect, test } from "bun:test";
import type { ActionPreset, TriggerPreset, TriggerVariant } from "./workflow-presets";
import {
  buildDefinitionFromPresets,
  buildDefinitionsForVariants,
  conditionsToFieldValues,
  fieldValuesToConditions,
} from "./workflow-presets-json";

const chatAction = {
  id: "b777b014-dca5-4e44-b238-11700cd4fc44",
  canonicalRef: "twitch_platform:action:twitch.chat.send",
  handlerType: "function",
  functionCall: "twitch_platform:function:sendChatMessage",
  name: "Send Chat Message",
  description: "Sends a message",
  category: "Chat",
  color: "",
} as ActionPreset;

describe("buildDefinitionFromPresets", () => {
  test("simple trigger+action produces a single-task definition", () => {
    const cheerTrigger = {
      id: "cheer",
      name: "Cheer",
      description: "When a user cheers",
      category: "Twitch",
      color: "",
      event: "cheer.user.twitch",
    } as unknown as TriggerPreset & { event: string };

    const def = buildDefinitionFromPresets(cheerTrigger, chatAction, {}, { message: "hi" });
    expect(def.trigger).toEqual({ type: "event", event: "cheer.user.twitch", conditions: [] });
    expect(def.tasks).toEqual([
      {
        id: "action-1",
        type: "action",
        action: "function",
        function: "twitch_platform:function:sendChatMessage",
        $ref: "twitch_platform:action:twitch.chat.send",
        parameters: { message: "hi" },
      },
    ]);
  });

  test("uses canonical refs on trigger and action, not engine UUIDs", () => {
    const cheerTrigger = {
      id: "uuid-trigger",
      canonicalRef: "twitch_platform:trigger:cheer.user.twitch",
      name: "Cheer",
      description: "When a user cheers",
      category: "Twitch",
      color: "",
      event: "cheer.user.twitch",
    } as unknown as TriggerPreset & { event: string };

    const def = buildDefinitionFromPresets(cheerTrigger, chatAction, {}, { message: "thanks" });
    expect((def.trigger as { $ref?: string }).$ref).toBe("twitch_platform:trigger:cheer.user.twitch");
    expect(def.tasks[0].action).toBe("function");
    expect(def.tasks[0].action).not.toMatch(/^[0-9a-f-]{36}$/i);
    expect((def.tasks[0] as { $ref?: string }).$ref).toBe("twitch_platform:action:twitch.chat.send");
  });

  test("commands source appends to event subject", () => {
    const commandTrigger = {
      id: "chatCommand",
      name: "Chat Command",
      description: "Triggered by a chat command",
      category: "Chat",
      color: "",
      event: "chat.command",
      config: {
        fields: [
          {
            id: "command",
            label: "Command",
            type: "select" as const,
            required: true,
            source: { kind: "commands" as const },
          },
        ],
      },
    } as unknown as TriggerPreset & { event: string };

    const def = buildDefinitionFromPresets(commandTrigger, chatAction, { command: "hello" }, { message: "hi" });
    expect(def.trigger.event).toBe("chat.command.hello");
    expect(def.trigger.conditions).toEqual([]);
  });

  test("internal source emits condition on eventPath, not subject suffix", () => {
    const redeemTrigger = {
      id: "redeem.channelpoints.twitch",
      name: "Channel point redemption",
      description: "Redeem",
      category: "Twitch",
      color: "",
      event: "redeem.channelpoints.twitch",
      config: {
        fields: [
          {
            id: "rewardId",
            label: "Reward",
            type: "select" as const,
            source: {
              kind: "internal" as const,
              request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
            },
            eventPath: "rewardId",
            operator: "eq" as const,
          },
        ],
      },
    } as unknown as TriggerPreset & { event: string };

    const def = buildDefinitionFromPresets(redeemTrigger, chatAction, { rewardId: "abc" }, {});
    expect(def.trigger.event).toBe("redeem.channelpoints.twitch");
    expect(def.trigger.conditions).toEqual([{ field: "${trigger.data.rewardId}", operator: "eq", value: "abc" }]);
  });

  test("cheer amount emits gte on amount", () => {
    const cheerTrigger = {
      id: "cheer.user.twitch",
      name: "Cheer",
      description: "Cheer",
      category: "Twitch",
      color: "",
      event: "cheer.user.twitch",
      config: {
        fields: [
          {
            id: "amount",
            label: "Minimum bits",
            type: "number" as const,
            eventPath: "amount",
            operator: "gte" as const,
          },
        ],
      },
    } as unknown as TriggerPreset & { event: string };

    const def = buildDefinitionFromPresets(cheerTrigger, chatAction, { amount: 100 }, {});
    expect(def.trigger.conditions).toEqual([{ field: "${trigger.data.amount}", operator: "gte", value: 100 }]);
  });
});

describe("buildDefinitionsForVariants", () => {
  test("two variants produce two definitions with trigger conditions", () => {
    const cheerTrigger = {
      id: "cheer.user.twitch",
      name: "Cheer",
      description: "Cheer",
      category: "Twitch",
      color: "",
      event: "cheer.user.twitch",
      config: {
        allowVariants: true,
        fields: [
          {
            id: "amount",
            label: "Minimum bits",
            type: "number" as const,
            eventPath: "amount",
            operator: "gte" as const,
          },
        ],
      },
    } as unknown as TriggerPreset & { event: string };

    const variants: TriggerVariant[] = [
      {
        id: "v1",
        displayName: "Cheer — 100",
        values: { amount: 100 },
        action: chatAction,
        actionConfig: { message: "a" },
      },
      {
        id: "v2",
        displayName: "Cheer — 500",
        values: { amount: 500 },
        action: chatAction,
        actionConfig: { message: "b" },
      },
    ];
    const defs = buildDefinitionsForVariants(cheerTrigger, variants);
    expect(defs).toHaveLength(2);
    expect(defs[0].trigger.conditions).toEqual([{ field: "${trigger.data.amount}", operator: "gte", value: 100 }]);
    expect(defs[0].tasks).toHaveLength(1);
    expect(defs[0].tasks[0].type).toBe("action");
    expect(defs[1].trigger.conditions?.[0]?.value).toBe(500);
    expect(defs[0].name).toBe("Cheer — 100 → Send Chat Message");
    expect(defs[1].name).toBe("Cheer — 500 → Send Chat Message");
  });
});

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

  test("falls back to defaults when no matching condition exists", () => {
    const fields = [{ id: "amount", label: "Minimum bits", type: "number" as const, eventPath: "amount", min: 5 }];
    const values = conditionsToFieldValues(fields, []);
    expect(values.amount).toBe(5);
  });

  test("round-trips through fieldValuesToConditions", () => {
    const fields = [{ id: "rewardId", label: "Reward", type: "select" as const, eventPath: "rewardId" }];
    const conditions = fieldValuesToConditions(fields, { rewardId: "abc" });
    expect(conditionsToFieldValues(fields, conditions)).toEqual({ rewardId: "abc" });
  });
});
