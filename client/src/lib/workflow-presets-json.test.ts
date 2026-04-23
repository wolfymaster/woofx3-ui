import { describe, expect, test } from "bun:test";
import type { ActionPreset, TierConfig, TriggerPreset } from "./workflow-presets";
import { buildDefinitionFromPresets, buildTieredDefinition } from "./workflow-presets-json";

const cheerTrigger = {
  id: "cheer",
  name: "Cheer",
  description: "When a user cheers",
  category: "Twitch",
  color: "",
  event: "cheer.user.twitch",
} as unknown as TriggerPreset & { event: string };

const chatAction = {
  id: "sendChatMessage",
  name: "Send Chat Message",
  description: "Sends a message",
  category: "Chat",
  color: "",
} as ActionPreset;

describe("buildDefinitionFromPresets", () => {
  test("simple trigger+action produces a single-task definition", () => {
    const def = buildDefinitionFromPresets(cheerTrigger, chatAction, {}, { message: "hi" });
    expect(def.trigger).toEqual({ type: "event", eventType: "cheer.user.twitch", conditions: [] });
    expect(def.tasks).toEqual([
      { id: "action-1", type: "action", action: "sendChatMessage", parameters: { message: "hi" } },
    ]);
    expect(def.name).toMatch(/Cheer/);
  });

  test("trigger with dynamic-source field appends picked value to eventType", () => {
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
    expect(def.trigger.eventType).toBe("chat.command.hello");
    // The dynamic-source field feeds the subject, not a payload condition.
    expect(def.trigger.conditions).toEqual([]);
  });

  test("trigger with dynamic-source field throws when config value is missing", () => {
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

    expect(() => buildDefinitionFromPresets(commandTrigger, chatAction, {}, {})).toThrow(/missing or not a string/);
  });

  test("trigger with multiple dynamic-source fields throws", () => {
    const bogusTrigger = {
      id: "bogus",
      name: "Bogus",
      description: "Two dynamic fields",
      category: "x",
      color: "",
      event: "bogus.event",
      config: {
        fields: [
          {
            id: "a",
            label: "A",
            type: "select" as const,
            source: { kind: "commands" as const },
          },
          {
            id: "b",
            label: "B",
            type: "select" as const,
            source: { kind: "commands" as const },
          },
        ],
      },
    } as unknown as TriggerPreset & { event: string };

    expect(() => buildDefinitionFromPresets(bogusTrigger, chatAction, { a: "x", b: "y" }, {})).toThrow(
      /multiple dynamic-source fields/
    );
  });
});

describe("buildTieredDefinition", () => {
  test("tier with single amount becomes condition + action pair", () => {
    const tiers: TierConfig[] = [
      {
        id: "t1",
        values: { amount: { type: "single", value: 100 } },
        action: chatAction,
        actionConfig: { message: "100!" },
      },
    ];
    const def = buildTieredDefinition(cheerTrigger, tiers);
    const checkIds = def.tasks.filter((t) => t.type === "condition").map((t) => t.id);
    const actionIds = def.tasks.filter((t) => t.type === "action").map((t) => t.id);
    expect(checkIds).toHaveLength(1);
    expect(actionIds).toHaveLength(1);
    const cond = def.tasks.find((t) => t.type === "condition");
    expect(cond?.conditions?.[0]).toMatchObject({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
      field: "${trigger.data.amount}",
      operator: "eq",
      value: 100,
    });
    expect(cond?.onTrue).toEqual([actionIds[0]]);
  });

  test("tier with range becomes between operator", () => {
    const tiers: TierConfig[] = [
      {
        id: "t1",
        values: { amount: { type: "range", min: 100, max: 500 } },
        action: chatAction,
        actionConfig: {},
      },
    ];
    const def = buildTieredDefinition(cheerTrigger, tiers);
    const cond = def.tasks.find((t) => t.type === "condition");
    expect(cond?.conditions?.[0]).toMatchObject({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: canonical engine selector syntax
      field: "${trigger.data.amount}",
      operator: "between",
      value: [100, 500],
    });
  });
});
