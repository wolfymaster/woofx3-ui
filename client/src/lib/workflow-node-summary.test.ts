import { describe, expect, test } from "bun:test";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { TriggerNode } from "@/lib/workflow-tree";
import { alertLayoutSummary, triggerNodeSummary } from "./workflow-node-summary";

function catalogTrigger(overrides: Partial<CatalogTriggerRow>): CatalogTriggerRow {
  return {
    id: "t1",
    name: "Channel Point Redemption",
    description: "",
    category: "twitch",
    color: "",
    icon: "Zap",
    event: "redeem.channelpoints.twitch",
    ...overrides,
  };
}

describe("triggerNodeSummary", () => {
  test("shows configured field values from conditions", () => {
    const node: TriggerNode = {
      type: "trigger",
      id: "__trigger",
      event: "redeem.channelpoints.twitch",
      conditions: [{ field: "${trigger.data.rewardTitle}", operator: "eq", value: "Free Hugs" }],
    };
    const catalog = [
      catalogTrigger({
        configFields: [{ id: "rewardTitle", label: "Reward", type: "text", eventPath: "rewardTitle" }],
      }),
    ];
    expect(triggerNodeSummary(node, catalog)).toEqual(["Reward: Free Hugs"]);
  });

  test("says a field with no matching condition matches any value, instead of showing a default", () => {
    const node: TriggerNode = { type: "trigger", id: "__trigger", event: "cheer.user.twitch", conditions: [] };
    const catalog = [
      catalogTrigger({
        event: "cheer.user.twitch",
        configFields: [{ id: "amount", label: "Minimum bits", type: "number", eventPath: "amount", min: 5 }],
      }),
    ];
    expect(triggerNodeSummary(node, catalog)).toEqual(["Minimum bits: any"]);
  });

  test("recovers the picked chat command from the assembled event suffix", () => {
    const node: TriggerNode = { type: "trigger", id: "__trigger", event: "chat.command.hug", conditions: [] };
    const catalog = [
      catalogTrigger({
        event: "chat.command",
        name: "Chat Command",
        configFields: [{ id: "command", label: "Command", type: "select", source: { kind: "commands" } }],
      }),
    ];
    expect(triggerNodeSummary(node, catalog)).toEqual(["Command: hug"]);
  });

  test("returns nothing when the catalog has no config fields", () => {
    const node: TriggerNode = { type: "trigger", id: "__trigger", event: "unknown.event", conditions: [] };
    expect(triggerNodeSummary(node, [])).toEqual([]);
  });
});

describe("alertLayoutSummary", () => {
  const entry = (id: string, zIndex: number, settings: Record<string, unknown>) => ({
    id,
    widgetCanonicalId: "woofx3:widget:text",
    name: id,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    rotation: 0,
    opacity: 1,
    zIndex,
    locked: false,
    visible: true,
    settings,
  });

  test("describes a step's own layout by its top text and layer count", () => {
    const layout = {
      width: 1920,
      height: 1080,
      widgets: [
        entry("image", 0, { src: "a.png" }),
        entry("text", 1, { text: "${trigger.data.userName} just followed!" }),
      ],
    };
    expect(alertLayoutSummary(layout)).toBe("“{userName} just followed!” · 2 layers");
  });

  test("an empty layout reads as empty", () => {
    expect(alertLayoutSummary({ width: 1920, height: 1080, widgets: [] })).toBe("Empty");
  });
});
