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
      { id: "action-1", type: "action", parameters: { action: "sendChatMessage", message: "hi" } },
    ]);
    expect(def.name).toMatch(/Cheer/);
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
