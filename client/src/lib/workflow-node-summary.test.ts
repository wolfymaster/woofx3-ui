import { describe, expect, test } from "bun:test";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import type { ActionNode, TriggerNode } from "@/lib/workflow-tree";
import { actionNodeSummary, triggerNodeSummary } from "./workflow-node-summary";

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

function catalogAction(overrides: Partial<CatalogActionRow>): CatalogActionRow {
  return {
    id: "a1",
    name: "Send Chat Message",
    description: "",
    category: "twitch",
    color: "",
    icon: "MessageSquare",
    handlerType: "function",
    functionCall: "twitch.chat.send",
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

  test("omits fields with no matching condition instead of showing a default", () => {
    const node: TriggerNode = { type: "trigger", id: "__trigger", event: "cheer.user.twitch", conditions: [] };
    const catalog = [
      catalogTrigger({
        event: "cheer.user.twitch",
        configFields: [{ id: "amount", label: "Minimum bits", type: "number", eventPath: "amount", min: 5 }],
      }),
    ];
    expect(triggerNodeSummary(node, catalog)).toEqual([]);
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

describe("actionNodeSummary", () => {
  test("shows configured parameter values directly", () => {
    const node: ActionNode = {
      type: "action",
      id: "a1",
      action: "function",
      parameters: { message: "Thanks for the follow!" },
      function: "twitch.chat.send",
    };
    const catalog = [
      catalogAction({
        configFields: [{ id: "message", label: "Message", type: "text" }],
      }),
    ];
    expect(actionNodeSummary(node, catalog)).toEqual(["Message: Thanks for the follow!"]);
  });

  test("formats select fields using the option label, not the raw value", () => {
    const node: ActionNode = { type: "action", id: "a1", action: "function", parameters: { voice: "en-US-1" } };
    const catalog = [
      catalogAction({
        configFields: [
          {
            id: "voice",
            label: "Voice",
            type: "select",
            options: [{ value: "en-US-1", label: "Aria (US)" }],
          },
        ],
      }),
    ];
    expect(actionNodeSummary(node, catalog)).toEqual(["Voice: Aria (US)"]);
  });

  test("omits empty parameter values", () => {
    const node: ActionNode = { type: "action", id: "a1", action: "function", parameters: { message: "" } };
    const catalog = [catalogAction({ configFields: [{ id: "message", label: "Message", type: "text" }] })];
    expect(actionNodeSummary(node, catalog)).toEqual([]);
  });

  test("resolves resource_ref values to their friendly display name via the label map", () => {
    const node: ActionNode = {
      type: "action",
      id: "a1",
      action: "function",
      parameters: { counter: "counters:counter:death_count" },
    };
    const catalog = [
      catalogAction({
        configFields: [{ id: "counter", label: "Counter", type: "resource_ref", kind: "counter" }],
      }),
    ];
    const resourceLabels = new Map([["counters:counter:death_count", "Death Count"]]);
    expect(actionNodeSummary(node, catalog, resourceLabels)).toEqual(["Counter: Death Count"]);
  });

  test("falls back to the raw canonical id when no label is resolved", () => {
    const node: ActionNode = {
      type: "action",
      id: "a1",
      action: "function",
      parameters: { counter: "counters:counter:death_count" },
    };
    const catalog = [
      catalogAction({
        configFields: [{ id: "counter", label: "Counter", type: "resource_ref", kind: "counter" }],
      }),
    ];
    expect(actionNodeSummary(node, catalog)).toEqual(["Counter: counters:counter:death_count"]);
  });
});
